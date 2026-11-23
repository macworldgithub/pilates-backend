import { Controller, Get, Injectable, Module, NotFoundException, Param, Query } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Connection } from 'mongoose';
import { clean } from './models';
import { DiscoverQuery } from './dto';
import { distance, geo, page, search } from './common';

@Injectable()
export class CatalogService {
  constructor(@InjectConnection() private readonly db: Connection) {}
  async published(model: string) { return (await this.db.model(model).find({ published: true }).lean()).map(clean); }
  async instructors() {
    const [instructors, studios, affiliations] = await Promise.all([this.published('Instructor'), this.published('Studio'), this.db.model('Affiliation').find().lean()]);
    const studioIds = new Set(studios.map(s => s.id));
    return instructors.filter(i => i.independent ? i.approvalStatus === 'approved' : affiliations.some(a => a.instructorId === i.id && studioIds.has(a.studioId)));
  }
  async workouts() {
    const [workouts, studios, instructors, affiliations] = await Promise.all([this.published('Workout'), this.published('Studio'), this.instructors(), this.db.model('Affiliation').find().lean()]);
    const studioIds = new Set(studios.map(x => x.id));
    const eligible = new Map(instructors.map(x => [x.id, x]));
    return workouts.filter(w => new Date(w.publishedAt) <= new Date() && studioIds.has(w.studioId) && w.instructorIds.every((id: string) => {
      const instructor = eligible.get(id);
      return instructor && (instructor.independent || affiliations.some(a => a.studioId === w.studioId && a.instructorId === id));
    })).sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  }
  async listStudios(q: DiscoverQuery) {
    const hasGeo = geo(q);
    let items = search(await this.published('Studio'), q).filter(s => (!q.format || s.formats.includes(q.format)) && (!q.city || s.city.toLowerCase() === q.city.toLowerCase()));
    if (hasGeo) {
      items = items.map(s => ({ ...s, distanceKm: distance({ latitude: q.latitude!, longitude: q.longitude! }, s) }));
      if (q.radiusKm !== undefined) items = items.filter(s => s.distanceKm <= q.radiusKm!);
      items.sort((a, b) => a.distanceKm - b.distanceKm);
    }
    return page(items, q);
  }
  async studio(id: string) {
    const studios = await this.published('Studio');
    const studio = studios.find(s => s.id === id);
    if (!studio) throw new NotFoundException('Studio not found');
    const [instructors, links, workouts, referrals] = await Promise.all([this.instructors(), this.db.model('Affiliation').find({ studioId: id }).lean(), this.workouts(), this.ownerReferrals('studio', id)]);
    return { ...studio, instructors: instructors.filter(i => links.some(l => l.instructorId === i.id)), workouts: workouts.filter(w => w.studioId === id), referrals };
  }
  async instructor(id: string) {
    const instructor = (await this.instructors()).find(i => i.id === id);
    if (!instructor) throw new NotFoundException('Instructor not found');
    const [links, studios, workouts, referrals] = await Promise.all([this.db.model('Affiliation').find({ instructorId: id }).lean(), this.published('Studio'), this.workouts(), this.ownerReferrals('instructor', id)]);
    return { ...instructor, studios: studios.filter(s => links.some(l => l.studioId === s.id)), workouts: workouts.filter(w => w.instructorIds.includes(id)), referrals };
  }
  async ownerReferrals(ownerType: string, ownerId: string) {
    const refs = await this.db.model('Referral').find({ ownerType, ownerId, active: true }).lean();
    return refs.map((ref: any) => ({ code: ref.code, deepLink: `projectorbit://referral/${encodeURIComponent(ref.code)}`, mode: 'simulated', commissionsEnabled: false }));
  }
  async listWorkouts(q: DiscoverQuery) {
    const items = search(await this.workouts(), q).filter(w => (!q.format || w.format === q.format) && (!q.level || w.level === q.level) && (!q.interest || w.interests.includes(q.interest)) && (!q.studioId || w.studioId === q.studioId) && (!q.instructorId || w.instructorIds.includes(q.instructorId)));
    return page(items, q);
  }
  async workout(id: string) {
    const workout = (await this.workouts()).find(w => w.id === id);
    if (!workout) throw new NotFoundException('Workout not found');
    const [products, instructors, studios] = await Promise.all([this.published('Product'), this.instructors(), this.published('Studio')]);
    return { ...workout, products: products.filter(p => workout.productIds.includes(p.id)), instructors: instructors.filter(i => workout.instructorIds.includes(i.id)), studio: studios.find(s => s.id === workout.studioId), mediaIsPlaceholder: true };
  }
  async listProducts(q: DiscoverQuery) {
    let products = search(await this.published('Product'), q).filter(p => (!q.collection || p.collection === q.collection) && (!q.tag || p.tags.includes(q.tag)));
    if (q.sort === 'price-asc' || q.sort === 'price-desc') products = products.sort((a, b) => (Math.min(...a.variants.map((v: any) => v.price)) - Math.min(...b.variants.map((v: any) => v.price))) * (q.sort === 'price-desc' ? -1 : 1));
    return { ...page(products, q), mode: 'simulated', inventorySource: 'sample-data' };
  }
  async product(id: string) {
    const products = await this.published('Product');
    const product = products.find(p => p.id === id);
    if (!product) throw new NotFoundException('Product not found');
    return { ...product, bundleProducts: products.filter(p => product.bundleProductIds.includes(p.id)), mode: 'simulated', inventorySource: 'sample-data' };
  }
  async referral(code: string) {
    const ref = clean(await this.db.model('Referral').findOne({ code: code.toUpperCase(), active: true }).lean());
    if (!ref) throw new NotFoundException('Referral not found');
    const owners = ref.ownerType === 'studio' ? await this.published('Studio') : await this.instructors();
    const owner = owners.find(x => x.id === ref.ownerId);
    if (!owner) throw new NotFoundException('Referral owner is not available');
    return { ...ref, owner: { id: owner.id, name: owner.name }, deepLink: `projectorbit://referral/${encodeURIComponent(ref.code)}`, mode: 'simulated', commissionsEnabled: false };
  }
  async offers(q: DiscoverQuery) {
    geo(q);
    // Location is explicit opt-in; no coordinates means no geo offers.
    if (q.latitude === undefined) return page([], q);
    const [offers, studios] = await Promise.all([this.db.model('Offer').find({ active: true, expiresAt: { $gt: new Date() } }).lean(), this.published('Studio')]);
    const items = offers.map(clean).flatMap(offer => {
      const studio = studios.find(s => s.id === offer.studioId && ['partner', 'stockist'].includes(s.partnerType));
      if (!studio) return [];
      const km = distance({ latitude: q.latitude!, longitude: q.longitude! }, studio);
      return km <= Math.min(offer.radiusKm, q.radiusKm ?? offer.radiusKm) ? [{ ...offer, studio: { id: studio.id, name: studio.name }, distanceKm: km }] : [];
    }).sort((a, b) => a.distanceKm - b.distanceKm);
    return page(items, q);
  }
}
@ApiTags('Discovery')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get('config') @ApiOperation({ summary: 'Prototype capabilities, shop boundary and onboarding options' }) config() {
    return { mode: 'simulated', currency: 'AUD', formats: ['mat', 'reformer'], interests: ['strength', 'mobility', 'balance', 'relaxation', 'flexibility'],
      shop: { environment: 'separate-shop', channel: 'D2C', source: 'sample-data', fulfillment: ['delivery', 'warehouse-collect'], realCheckout: false },
      features: { bookings: false, community: false, commissions: false, studioInventory: false, partnerSelfService: false, payments: false },
      discounts: [{ code: 'WELCOME15', percent: 15, firstOrderOnly: true }, { code: 'SEASON10', percent: 10, firstOrderOnly: false }] };
  }
  @Get('studios') studios(@Query() q: DiscoverQuery) { return this.catalog.listStudios(q); }
  @Get('studios/:id') studio(@Param('id') id: string) { return this.catalog.studio(id); }
  @Get('instructors/:id') instructor(@Param('id') id: string) { return this.catalog.instructor(id); }
  @Get('workouts') workouts(@Query() q: DiscoverQuery) { return this.catalog.listWorkouts(q); }
  @Get('workouts/:id') workout(@Param('id') id: string) { return this.catalog.workout(id); }
  @Get('shop/products') products(@Query() q: DiscoverQuery) { return this.catalog.listProducts(q); }
  @Get('shop/products/:id') product(@Param('id') id: string) { return this.catalog.product(id); }
  @Get('shop/collections') async collections() { const products = await this.catalog.published('Product'); return { data: [...new Set(products.map(p => p.collection))] }; }
  @Get('referrals/:code') referral(@Param('code') code: string) { return this.catalog.referral(code); }
  @Get('offers') offers(@Query() q: DiscoverQuery) { return this.catalog.offers(q); }
}
@Module({ controllers: [CatalogController], providers: [CatalogService], exports: [CatalogService] })
export class CatalogModule {}
