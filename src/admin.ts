import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiOperation, ApiParam, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { Connection } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { AdminGuard, page, requireValue, search } from './common';
import { clean, collections } from './models';
import { AffiliationDto, InstructorDto, OfferDto, PageQuery, ProductDto, ReferralDto, StudioDto, WorkoutDto } from './dto';

const dtos: Record<string, any> = { studios: StudioDto, instructors: InstructorDto, workouts: WorkoutDto, products: ProductDto, referrals: ReferralDto, offers: OfferDto };
const oneOf = Object.values(dtos).map(dto => ({ $ref: getSchemaPath(dto) }));
@Injectable()
export class AdminService {
  constructor(@InjectConnection() private readonly db: Connection) {}
  model(kind: string) {
    const name = Object.hasOwn(collections, kind) && collections[kind];
    if (!name) throw new NotFoundException('Resource not found');
    return this.db.model(name);
  }
  async list(kind: string, q: PageQuery) { return page(search((await this.model(kind).find().sort({ createdAt: -1 }).lean()).map(clean), q), q); }
  async get(kind: string, id: string) {
    const doc = clean(await this.model(kind).findById(id).lean());
    if (!doc) throw new NotFoundException('Record not found');
    return doc;
  }
  async exists(kind: string, id: string) { requireValue(await this.model(kind).exists({ _id: id }), `Referenced ${kind} record does not exist: ${id}`); }
  async rules(kind: string, data: any, id: string) {
    if (kind === 'instructors') requireValue(!data.independent || !data.published || data.approvalStatus === 'approved', 'Independent instructors require MoveActive approval before publication');
    if (kind === 'studios' && data.partnerType === 'listed') requireValue(!await this.db.model('Offer').exists({ studioId: id, active: true }), 'Disable partner geo offers before changing this studio to a basic listing');
    if (kind === 'workouts') {
      await this.exists('studios', data.studioId);
      for (const instructorId of data.instructorIds) {
        await this.exists('instructors', instructorId);
        const i = await this.get('instructors', instructorId);
        requireValue(i.independent ? i.approvalStatus === 'approved' : await this.db.model('Affiliation').exists({ studioId: data.studioId, instructorId }), 'Workout instructors must be affiliated with the studio or approved independents');
      }
      for (const productId of data.productIds) await this.exists('products', productId);
    }
    if (kind === 'products') {
      requireValue(new Set(data.variants.map((v: any) => v.id)).size === data.variants.length, 'Variant IDs must be unique');
      for (const productId of data.bundleProductIds) {
        requireValue(productId !== id, 'A bundle cannot include itself');
        await this.exists('products', productId);
        const p = await this.get('products', productId);
        requireValue(p.currency === data.currency, 'Bundle components must use the same currency');
        requireValue(!p.bundleProductIds.length, 'Nested bundles are not supported in this prototype');
      }
      const parents = await this.db.model('Product').find({ bundleProductIds: id }).lean();
      requireValue(parents.every((p: any) => p.currency === data.currency) && (!parents.length || !data.bundleProductIds.length), 'Change would invalidate an existing bundle');
    }
    if (kind === 'referrals') await this.exists(data.ownerType === 'studio' ? 'studios' : 'instructors', data.ownerId);
    if (kind === 'offers') {
      await this.exists('studios', data.studioId);
      const studio = await this.get('studios', data.studioId);
      requireValue(['partner', 'stockist'].includes(studio.partnerType), 'Geo offers are reserved for studio partners and stockists');
    }
  }
  async save(kind: string, body: unknown, id?: string) {
    const model = this.model(kind);
    requireValue(body !== null && typeof body === 'object' && !Array.isArray(body), 'Body must be a JSON object');
    const input = body as Record<string, unknown>;
    requireValue(Object.keys(input).length > 0, 'Body cannot be empty');
    const original = id ? await this.get(kind, id) : {};
    const { id: ignored, createdAt, updatedAt, ...base } = original;
    // Validate the complete merged record, including unknown keys and null values.
    const data = plainToInstance(dtos[kind], { ...base, ...input });
    const errors = await validate(data, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true });
    if (errors.length) throw new BadRequestException(errors.map(e => ({ field: e.property, constraints: e.constraints, children: e.children })));
    const recordId = id ?? randomUUID();
    await this.rules(kind, data, recordId);
    const saved = id ? await model.findOneAndUpdate({ _id: id }, { $set: data }, { new: true, runValidators: true }) : await model.create({ _id: recordId, ...data });
    await this.audit(id ? 'update' : 'create', kind, recordId);
    return clean(saved);
  }
  async archive(kind: string, id: string) {
    await this.get(kind, id);
    const field = ['referrals', 'offers'].includes(kind) ? 'active' : 'published';
    await this.model(kind).updateOne({ _id: id }, { $set: { [field]: false } });
    await this.audit('archive', kind, id);
    return { id, archived: true, note: 'References and historical demo orders are retained' };
  }
  async affiliate(dto: AffiliationDto) {
    await this.exists('studios', dto.studioId); await this.exists('instructors', dto.instructorId);
    const record = await this.db.model('Affiliation').findOneAndUpdate({ ...dto }, { $setOnInsert: dto }, { upsert: true, new: true, runValidators: true });
    await this.audit('affiliate', 'affiliations', `${dto.studioId}/${dto.instructorId}`);
    return clean(record);
  }
  async unaffiliate(studioId: string, instructorId: string) {
    requireValue(!await this.db.model('Workout').exists({ studioId, instructorIds: instructorId, published: true }), 'Unpublish or update linked workouts before removing this affiliation');
    const result = await this.db.model('Affiliation').deleteOne({ studioId, instructorId });
    if (!result.deletedCount) throw new NotFoundException('Affiliation not found');
    await this.audit('unaffiliate', 'affiliations', `${studioId}/${instructorId}`);
    return { removed: true };
  }
  async audit(action: string, entityType: string, entityId: string) { await this.db.model('Audit').create({ _id: randomUUID(), action, entityType, entityId }); }
  async activity(model: string, q: PageQuery) {
    const [total, rows] = await Promise.all([this.db.model(model).countDocuments(), this.db.model(model).find().sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean()]);
    return { data: rows.map(clean), pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) } };
  }
  async overview() {
    const counts = await Promise.all(Object.entries(collections).map(async ([key, model]) => [key, await this.db.model(model).countDocuments()]));
    return { mode: 'simulated', counts: Object.fromEntries(counts), demoOrders: await this.db.model('Order').countDocuments(), commissionsEnabled: false };
  }
}
@ApiTags('MoveActive internal admin') @ApiBearerAuth('admin') @UseGuards(AdminGuard)
@ApiExtraModels(StudioDto, InstructorDto, WorkoutDto, ProductDto, ReferralDto, OfferDto)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}
  @Get('overview') overview() { return this.admin.overview(); }
  @Get('activity/events') events(@Query() q: PageQuery) { return this.admin.activity('Event', q); }
  @Get('activity/audit') audit(@Query() q: PageQuery) { return this.admin.activity('Audit', q); }
  @Get('activity/orders') orders(@Query() q: PageQuery) { return this.admin.activity('Order', q); }
  @Get('affiliations') affiliations(@Query() q: PageQuery) { return this.admin.activity('Affiliation', q); }
  @Post('affiliations') affiliate(@Body() dto: AffiliationDto) { return this.admin.affiliate(dto); }
  @Delete('affiliations/:studioId/:instructorId') unaffiliate(@Param('studioId') s: string, @Param('instructorId') i: string) { return this.admin.unaffiliate(s, i); }
  @Get(':kind') @ApiParam({ name: 'kind', enum: Object.keys(collections) }) list(@Param('kind') kind: string, @Query() q: PageQuery) { return this.admin.list(kind, q); }
  @Get(':kind/:id') @ApiParam({ name: 'kind', enum: Object.keys(collections) }) get(@Param('kind') kind: string, @Param('id') id: string) { return this.admin.get(kind, id); }
  @Post(':kind') @ApiParam({ name: 'kind', enum: Object.keys(collections) }) @ApiBody({ schema: { oneOf } }) create(@Param('kind') kind: string, @Body() body: Record<string, unknown>) { return this.admin.save(kind, body); }
  @Patch(':kind/:id') @ApiParam({ name: 'kind', enum: Object.keys(collections) }) @ApiBody({ schema: { type: 'object', description: 'Any editable fields from the matching create schema. Unknown fields and nulls are rejected.' } })
  update(@Param('kind') kind: string, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.admin.save(kind, body, id); }
  @Delete(':kind/:id') @ApiOperation({ summary: 'Archive a resource without deleting historical references' }) @ApiParam({ name: 'kind', enum: Object.keys(collections) })
  archive(@Param('kind') kind: string, @Param('id') id: string) { return this.admin.archive(kind, id); }
}
@Module({ controllers: [AdminController], providers: [AdminService, AdminGuard] })
export class AdminModule {}
