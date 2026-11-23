import { Body, ConflictException, Controller, Delete, Get, Headers, Injectable, Module, NotFoundException, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientSession, Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { ApplyReferralDto, CartItemDto, CheckoutDto, EventDto, PageQuery } from './dto';
import { hash, page, requireValue, SessionGuard, SessionRequest } from './common';
import { CatalogModule, CatalogService } from './catalog';
import { SessionsModule } from './sessions';
import { clean } from './models';

@Injectable()
export class CommerceService {
  constructor(@InjectConnection() private readonly db: Connection, private readonly catalog: CatalogService) {}
  async session(id: string, tx?: ClientSession) {
    const s: any = await this.db.model('Session').findOne({ _id: id, expiresAt: { $gt: new Date() } }).session(tx ?? null).lean();
    if (!s) throw new NotFoundException('Session not found');
    return s;
  }
  async mutateCart(id: string, transform: (items: any[]) => any[]) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const s = await this.session(id);
      const cart = transform(s.cart);
      requireValue(cart.length <= 50, 'Cart may contain up to 50 distinct variants');
      const result = await this.db.model('Session').updateOne({ _id: id, revision: s.revision }, { $set: { cart }, $inc: { revision: 1 } });
      if (result.modifiedCount) return this.cart(id);
    }
    throw new ConflictException('Cart changed; retry the request');
  }
  async putItem(id: string, dto: CartItemDto) {
    const p = await this.catalog.product(dto.productId);
    requireValue(p.variants.some((v: any) => v.id === dto.variantId && v.available), 'Variant is unavailable');
    return this.mutateCart(id, items => [...items.filter(i => i.productId !== dto.productId || i.variantId !== dto.variantId), dto]);
  }
  removeItem(id: string, product: string, variant: string) { return this.mutateCart(id, items => items.filter(i => i.productId !== product || i.variantId !== variant)); }
  clear(id: string) { return this.mutateCart(id, () => []); }
  async cart(id: string) {
    const s = await this.session(id);
    const products = await this.catalog.published('Product');
    const items = s.cart.map((i: any) => {
      const product = products.find(p => p.id === i.productId), variant = product?.variants.find((v: any) => v.id === i.variantId);
      return { ...i, productTitle: product?.title ?? 'Unavailable product', variantTitle: variant?.title ?? null, imageUrl: product?.imageUrl ?? null, unitPrice: variant?.price ?? null, currency: product?.currency ?? null, available: Boolean(variant?.available), lineTotal: variant ? variant.price * i.quantity : null };
    });
    const currencies = [...new Set(items.map((i: any) => i.currency).filter(Boolean))];
    return { items, revision: s.revision, subtotal: currencies.length <= 1 && items.every((i: any) => i.available) ? items.reduce((sum: number, i: any) => sum + i.lineTotal, 0) : null, currency: currencies.length === 1 ? currencies[0] : null, checkoutReady: items.length > 0 && currencies.length === 1 && items.every((i: any) => i.available), mode: 'simulated' };
  }
  async applyReferral(id: string, dto: ApplyReferralDto) {
    const referral = await this.catalog.referral(dto.code);
    await this.db.model('Session').updateOne({ _id: id }, { $set: { referralCode: referral.code }, $inc: { revision: 1 } });
    return { referral, attribution: 'last-applied-referral', commission: null };
  }
  async quote(id: string, dto: CheckoutDto, tx?: ClientSession) {
    const s = await this.session(id, tx);
    requireValue(s.cart.length > 0, 'Cart is empty');
    const products = (await this.db.model('Product').find({ _id: { $in: s.cart.map((i: any) => i.productId) }, published: true }).session(tx ?? null).lean()).map(clean);
    const items = s.cart.map((i: any) => {
      const p = products.find(p => p.id === i.productId), v = p?.variants.find((v: any) => v.id === i.variantId);
      requireValue(p && v?.available, `Product or variant is unavailable: ${i.productId}/${i.variantId}`);
      return { productId: p.id, productTitle: p.title, variantId: v.id, variantTitle: v.title, quantity: i.quantity, unitPrice: v.price, lineTotal: v.price * i.quantity, currency: p.currency };
    });
    requireValue(new Set(items.map((i: any) => i.currency)).size === 1, 'All cart items must use the same currency');
    if (dto.discountCode === 'WELCOME15') {
      const prior = await this.db.model('Order').exists({ sessionId: id }).session(tx ?? null);
      requireValue(!prior, 'WELCOME15 is only available for the first demo order in this session');
    }
    const subtotal = items.reduce((sum: number, i: any) => sum + i.lineTotal, 0);
    const discountPercent = dto.discountCode === 'WELCOME15' ? 15 : dto.discountCode === 'SEASON10' ? 10 : 0;
    const discount = Math.round(subtotal * discountPercent / 100);
    const shipping = dto.fulfillment === 'warehouse-collect' || subtotal - discount >= 7500 ? 0 : 800;
    let attribution = null;
    if (s.referralCode) {
      try { const ref = await this.catalog.referral(s.referralCode); attribution = { code: ref.code, ownerType: ref.ownerType, ownerId: ref.ownerId }; }
      catch (e) { if (!(e instanceof NotFoundException)) throw e; }
    }
    return { items, currency: items[0].currency, subtotal, discountCode: dto.discountCode ?? null, discountPercent, discount, shipping,
      total: subtotal - discount + shipping, fulfillment: dto.fulfillment, source: dto.source, attribution,
      tax: { included: true, mode: 'sample-pricing-no-tax-calculation' }, revision: s.revision,
      mode: 'simulated', paymentRequired: false, inventoryUpdated: false, notice: 'Demo only. No charge, reservation, fulfillment or live inventory change.' };
  }
  async checkout(id: string, key: string | undefined, dto: CheckoutDto) {
    requireValue(key && /^[A-Za-z0-9_-]{8,100}$/.test(key), 'Idempotency-Key header must contain 8-100 letters, digits, underscores or hyphens');
    const requestHash = hash(JSON.stringify({ discountCode: dto.discountCode ?? null, fulfillment: dto.fulfillment, source: dto.source }));
    const replay = (order: any) => {
      if (order.requestHash !== requestHash) throw new ConflictException('Idempotency key was already used with a different request');
      return { ...order.snapshot, id: String(order._id), createdAt: order.createdAt };
    };
    const existing = await this.db.model('Order').findOne({ sessionId: id, idempotencyKey: key }).lean();
    if (existing) return replay(existing);
    // Atomic order creation and cart clearing require a replica set (Atlas provides one).
    return this.db.transaction(async tx => {
      const prior = await this.db.model('Order').findOne({ sessionId: id, idempotencyKey: key }).session(tx).lean();
      if (prior) return replay(prior);
      const quote = await this.quote(id, dto, tx);
      const orderId = `demo-${randomUUID()}`;
      const createdAt = new Date();
      const snapshot = { ...quote, status: 'demo-confirmed', createdAt };
      const updated = await this.db.model('Session').updateOne({ _id: id, revision: quote.revision }, { $set: { cart: [] }, $inc: { revision: 1 } }, { session: tx });
      if (!updated.modifiedCount) throw new ConflictException('Cart changed; request a new quote');
      await this.db.model('Order').create([{ _id: orderId, sessionId: id, idempotencyKey: key, requestHash, snapshot }], { session: tx });
      await this.db.model('Event').create([{ _id: randomUUID(), sessionId: id, name: 'demo_order_confirmed', source: dto.source, metadata: { orderId, attribution: quote.attribution, total: quote.total, currency: quote.currency } }], { session: tx });
      return { ...snapshot, id: orderId };
    });
  }
  async orders(id: string, q: PageQuery) {
    const orders = await this.db.model('Order').find({ sessionId: id }).sort({ createdAt: -1 }).lean();
    return page(orders.map((o: any) => ({ ...o.snapshot, id: String(o._id), createdAt: o.createdAt })), q);
  }
  async order(id: string, orderId: string) {
    const o: any = await this.db.model('Order').findOne({ _id: orderId, sessionId: id }).lean();
    if (!o) throw new NotFoundException('Order not found');
    return { ...o.snapshot, id: String(o._id), createdAt: o.createdAt };
  }
  async event(id: string, dto: EventDto) {
    const eventId = randomUUID();
    await this.db.model('Event').create({ _id: eventId, sessionId: id, name: dto.name, source: dto.source, metadata: { entityId: dto.entityId } });
    return { id: eventId, recorded: true, destination: 'local-prototype-only' };
  }
}
@ApiTags('Simulated consumer commerce') @ApiBearerAuth('session') @UseGuards(SessionGuard)
@Controller()
export class CommerceController {
  constructor(private readonly commerce: CommerceService) {}
  @Get('shop/cart') cart(@Req() req: SessionRequest) { return this.commerce.cart(req.sessionId); }
  @Put('shop/cart/items') @ApiOperation({ summary: 'Set the absolute quantity for a product variant' }) put(@Req() req: SessionRequest, @Body() dto: CartItemDto) { return this.commerce.putItem(req.sessionId, dto); }
  @Delete('shop/cart/items/:productId/:variantId') remove(@Req() req: SessionRequest, @Param('productId') p: string, @Param('variantId') v: string) { return this.commerce.removeItem(req.sessionId, p, v); }
  @Delete('shop/cart') clear(@Req() req: SessionRequest) { return this.commerce.clear(req.sessionId); }
  @Post('referrals/apply') apply(@Req() req: SessionRequest, @Body() dto: ApplyReferralDto) { return this.commerce.applyReferral(req.sessionId, dto); }
  @Post('shop/checkout/quote') quote(@Req() req: SessionRequest, @Body() dto: CheckoutDto) { return this.commerce.quote(req.sessionId, dto); }
  @Post('shop/checkout') @ApiOperation({ summary: 'Create a simulated order; no payment or real inventory writes' }) @ApiHeader({ name: 'Idempotency-Key', required: true, example: 'demo-checkout-001' })
  checkout(@Req() req: SessionRequest, @Headers('idempotency-key') key: string, @Body() dto: CheckoutDto) { return this.commerce.checkout(req.sessionId, key, dto); }
  @Get('shop/orders') orders(@Req() req: SessionRequest, @Query() q: PageQuery) { return this.commerce.orders(req.sessionId, q); }
  @Get('shop/orders/:id') order(@Req() req: SessionRequest, @Param('id') id: string) { return this.commerce.order(req.sessionId, id); }
  @Post('events') event(@Req() req: SessionRequest, @Body() dto: EventDto) { return this.commerce.event(req.sessionId, dto); }
}
@Module({ imports: [CatalogModule, SessionsModule], controllers: [CommerceController], providers: [CommerceService] })
export class CommerceModule {}
