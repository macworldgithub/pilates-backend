import 'reflect-metadata';
import { after, before, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { json } from 'express';
import request from 'supertest';

let repl: MongoMemoryReplSet, app: any, db: any, api: any;
const adminToken = 'scope-test-admin-token-longer-than-32-characters';
const admin = { Authorization: `Bearer ${adminToken}` };
const checkout = { fulfillment: 'delivery', source: 'web' };
async function consumer() {
  const s = (await api.post('/api/v1/sessions').expect(201)).body;
  return { id: s.id, headers: { Authorization: `Bearer ${s.token}` } };
}
async function add(headers: any, quantity = 1) {
  await api.put('/api/v1/shop/cart/items').set(headers).send({ productId: 'product-socks', variantId: 'socks-s', quantity }).expect(200);
}
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR = resolve('.cache/mongodb-binaries');
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = repl.getUri('orbit_scope_test');
  process.env.ADMIN_TOKEN = adminToken;
  process.env.NODE_ENV = 'test';
  const { AppModule } = require('../dist/app.module');
  const { configure } = require('../dist/common');
  const { seedDatabase } = require('../dist/seed');
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication({ logger: false, bodyParser: false });
  app.use(json({ limit: '64kb', strict: true }));
  app.useStaticAssets(resolve('public'), { prefix: '/media/' });
  configure(app, ['http://localhost:8081']);
  await app.init();
  db = app.get(getConnectionToken());
  await seedDatabase(db);
  api = request(app.getHttpServer());
}, { timeout: 180000 });
after(async () => { if (app) await app.close(); if (repl) await repl.stop(); });

test('scope: admin creates and updates a studio with outbound links and search visibility', async () => {
  const template = (await api.get('/api/v1/admin/studios/studio-london').set(admin).expect(200)).body;
  const { id, createdAt, updatedAt, ...body } = template;
  const created = (await api.post('/api/v1/admin/studios').set(admin).send({ ...body, name: 'Scope Test Studio', city: 'Test City' }).expect(201)).body;
  assert(created.id !== id);
  const found = (await api.get('/api/v1/studios?search=scope%20test&format=reformer').expect(200)).body;
  assert.equal(found.data[0].id, created.id);
  assert.equal(new URL(found.data[0].bookingUrl).protocol, 'https:');
  await api.patch(`/api/v1/admin/studios/${created.id}`).set(admin).send({ name: 'Updated Scope Studio' }).expect(200);
  assert.equal((await api.get(`/api/v1/studios/${created.id}`).expect(200)).body.name, 'Updated Scope Studio');
  await api.delete(`/api/v1/admin/studios/${created.id}`).set(admin).expect(200);
  await api.get(`/api/v1/studios/${created.id}`).expect(404);
});

test('scope: scheduled and archived workouts stay hidden in discovery and studio profiles', async () => {
  const original = await db.model('Workout').findById('workout-mat').lean();
  try {
    await db.model('Workout').updateOne({ _id: original._id }, { $set: { publishedAt: new Date(Date.now() + 86400000) } });
    await api.get('/api/v1/workouts/workout-mat').expect(404);
    assert(!(await api.get('/api/v1/studios/studio-melbourne').expect(200)).body.workouts.some((w: any) => w.id === original._id));
    await db.model('Workout').updateOne({ _id: original._id }, { $set: { publishedAt: original.publishedAt, published: false } });
    assert(!(await api.get('/api/v1/workouts').expect(200)).body.data.some((w: any) => w.id === original._id));
  } finally { await db.model('Workout').updateOne({ _id: original._id }, { $set: { publishedAt: original.publishedAt, published: true } }); }
});

test('scope: archiving a studio hides its instructor, content and referral until restored', async () => {
  try {
    await api.delete('/api/v1/admin/studios/studio-melbourne').set(admin).expect(200);
    for (const path of ['/studios/studio-melbourne', '/instructors/instructor-ella', '/workouts/workout-mat', '/referrals/FITZROY-DEMO']) await api.get(`/api/v1${path}`).expect(404);
    assert.equal((await api.get('/api/v1/offers?latitude=-37.798&longitude=144.978').expect(200)).body.data.length, 0);
  } finally { await db.model('Studio').updateOne({ _id: 'studio-melbourne' }, { $set: { published: true } }); }
});

test('scope: approved independents become visible; rejected and pending independents remain hidden', async () => {
  try {
    await api.patch('/api/v1/admin/instructors/instructor-alex').set(admin).send({ approvalStatus: 'approved', published: true }).expect(200);
    await api.get('/api/v1/instructors/instructor-alex').expect(200);
    await api.patch('/api/v1/admin/instructors/instructor-alex').set(admin).send({ approvalStatus: 'rejected' }).expect(400);
    await api.patch('/api/v1/admin/instructors/instructor-alex').set(admin).send({ approvalStatus: 'rejected', published: false }).expect(200);
    await api.get('/api/v1/instructors/instructor-alex').expect(404);
  } finally { await db.model('Instructor').updateOne({ _id: 'instructor-alex' }, { $set: { approvalStatus: 'pending', published: false } }); }
});

test('scope: expired and disabled partner offers never reach the consumer', async () => {
  const offer = await db.model('Offer').findById('offer-fitzroy').lean();
  try {
    await db.model('Offer').updateOne({ _id: offer._id }, { $set: { expiresAt: new Date(0) } });
    assert.equal((await api.get('/api/v1/offers?latitude=-37.798&longitude=144.978').expect(200)).body.data.length, 0);
    await db.model('Offer').updateOne({ _id: offer._id }, { $set: { expiresAt: offer.expiresAt, active: false } });
    assert.equal((await api.get('/api/v1/offers?latitude=-37.798&longitude=144.978').expect(200)).body.data.length, 0);
  } finally { await db.model('Offer').updateOne({ _id: offer._id }, { $set: { expiresAt: offer.expiresAt, active: true } }); }
});

test('scope: unavailable products are rechecked at checkout and the cart survives rejection', async () => {
  const s = await consumer(); await add(s.headers);
  try {
    await api.delete('/api/v1/admin/products/product-socks').set(admin).expect(200);
    assert.equal((await api.get('/api/v1/shop/cart').set(s.headers).expect(200)).body.checkoutReady, false);
    await api.post('/api/v1/shop/checkout').set({ ...s.headers, 'Idempotency-Key': randomUUID() }).send(checkout).expect(400);
    assert.equal(await db.model('Order').countDocuments({ sessionId: s.id }), 0);
    assert.equal((await api.get('/api/v1/shop/cart').set(s.headers).expect(200)).body.items.length, 1);
  } finally { await db.model('Product').updateOne({ _id: 'product-socks' }, { $set: { published: true } }); }
});

test('scope: seasonal discounts, sample shipping and warehouse collection calculate correctly', async () => {
  const s = await consumer(); await add(s.headers);
  const quote = (await api.post('/api/v1/shop/checkout/quote').set(s.headers).send({ ...checkout, discountCode: 'SEASON10' }).expect(201)).body;
  assert.equal(quote.subtotal, 2200); assert.equal(quote.discount, 220); assert.equal(quote.shipping, 800); assert.equal(quote.total, 2780);
  const collect = (await api.post('/api/v1/shop/checkout/quote').set(s.headers).send({ ...checkout, fulfillment: 'warehouse-collect' }).expect(201)).body;
  assert.equal(collect.shipping, 0);
  await add(s.headers, 4);
  assert.equal((await api.post('/api/v1/shop/checkout/quote').set(s.headers).send(checkout).expect(201)).body.shipping, 0);
  await api.post('/api/v1/shop/checkout/quote').set(s.headers).send({ ...checkout, fulfillment: 'studio-pickup' }).expect(400);
  await api.post('/api/v1/shop/checkout/quote').set(s.headers).send({ ...checkout, discountCode: 'REAL-CODE' }).expect(400);
});

test('scope: checkout rolls back order and cart writes when event persistence fails', async () => {
  const s = await consumer(); await add(s.headers);
  const eventModel = db.model('Event');
  const stub = mock.method(eventModel, 'create', async () => { throw new Error('Injected test persistence failure'); });
  try {
    await api.post('/api/v1/shop/checkout').set({ ...s.headers, 'Idempotency-Key': randomUUID() }).send(checkout).expect(500);
  } finally { stub.mock.restore(); }
  assert.equal(await db.model('Order').countDocuments({ sessionId: s.id }), 0);
  assert.equal((await api.get('/api/v1/shop/cart').set(s.headers).expect(200)).body.items.length, 1);
});

test('scope: order snapshots preserve original product pricing and app/web attribution', async () => {
  const s = await consumer(); await add(s.headers);
  await api.post('/api/v1/referrals/apply').set(s.headers).send({ code: 'ELLA-DEMO' }).expect(201);
  const order = (await api.post('/api/v1/shop/checkout').set({ ...s.headers, 'Idempotency-Key': randomUUID() }).send(checkout).expect(201)).body;
  assert.equal(order.source, 'web'); assert.equal(order.attribution.ownerType, 'instructor');
  const event = await db.model('Event').findOne({ 'metadata.orderId': order.id }).lean();
  assert.equal(event.source, 'web'); assert.equal(event.metadata.attribution.code, 'ELLA-DEMO');
  const product = await db.model('Product').findById('product-socks').lean();
  try {
    await db.model('Product').updateOne({ _id: product._id }, { $set: { 'variants.0.price': 9999, title: 'Changed Product' } });
    const saved = (await api.get(`/api/v1/shop/orders/${order.id}`).set(s.headers).expect(200)).body;
    assert.equal(saved.items[0].unitPrice, 2200); assert.equal(saved.items[0].productTitle, 'Demo Grip Socks');
  } finally { await db.model('Product').updateOne({ _id: product._id }, { $set: { variants: product.variants, title: product.title } }); }
});

test('scope: inactive referrals fail and duplicate codes are rejected without commissions', async () => {
  const s = await consumer();
  await api.post('/api/v1/admin/referrals').set(admin).send({ code: 'FITZROY-DEMO', ownerType: 'studio', ownerId: 'studio-melbourne', active: true }).expect(409);
  try {
    await api.delete('/api/v1/admin/referrals/referral-fitzroy').set(admin).expect(200);
    await api.get('/api/v1/referrals/FITZROY-DEMO').expect(404);
    await api.post('/api/v1/referrals/apply').set(s.headers).send({ code: 'FITZROY-DEMO' }).expect(404);
  } finally { await db.model('Referral').updateOne({ _id: 'referral-fitzroy' }, { $set: { active: true } }); }
  const referral = (await api.get('/api/v1/referrals/ELLA-DEMO').expect(200)).body;
  assert.equal(referral.commissionsEnabled, false);
});

test('scope: excluded services have no API routes and checkout refuses real payment data', async () => {
  for (const path of ['community', 'bookings', 'waitlists', 'commissions', 'payouts', 'studio-inventory', 'wholesale', 'studio-portal', 'instructor-portal', 'ai/form-correction', 'shop/payments']) {
    await api.get(`/api/v1/${path}`).expect(404);
    await api.post(`/api/v1/${path}`).send({}).expect(404);
  }
  const s = await consumer(); await add(s.headers);
  await api.post('/api/v1/shop/checkout').set({ ...s.headers, 'Idempotency-Key': randomUUID() }).send({ ...checkout, cardNumber: 'demo-not-a-card' }).expect(400);
  await api.post('/api/v1/shop/checkout').set(s.headers).send(checkout).expect(400);
});

test('scope: malformed JSON, oversized bodies and browser origin rules are enforced', async () => {
  await api.post('/api/v1/sessions').set('Content-Type', 'application/json').send('{broken').expect(400);
  await api.post('/api/v1/sessions').send({ padding: 'x'.repeat(66000) }).expect(413);
  const allowed = await api.get('/api/v1/config').set('Origin', 'http://localhost:8081').expect(200);
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:8081');
  const denied = await api.get('/api/v1/config').set('Origin', 'https://unlisted.example').expect(200);
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
  assert(allowed.headers['x-content-type-options']);
});

test('frontend seed: studio, instructor, workout, tagged products and MIA10 form a complete journey', async () => {
  const studio = (await api.get('/api/v1/studios/core-collective').expect(200)).body;
  assert.equal(studio.name, 'Core Collective');
  assert(studio.instructors.some((i: any) => i.id === 'mia-chen'));
  assert(studio.workouts.some((w: any) => w.id === 'reformer-reset'));
  const instructor = (await api.get('/api/v1/instructors/mia-chen').expect(200)).body;
  assert.equal(instructor.studios[0].id, 'core-collective');
  assert.equal(instructor.referrals[0].code, 'MIA10');
  const workout = (await api.get('/api/v1/workouts/reformer-reset').expect(200)).body;
  assert.equal(workout.durationMinutes, 15);
  assert(workout.products.some((p: any) => p.id === 'grip-socks-pink'));
  assert(workout.products.some((p: any) => p.id === 'starter-bundle'));
  const mat = (await api.get('/api/v1/shop/products/yoga-mat-espresso').expect(200)).body;
  assert.equal(mat.variants[0].price, 10900);
});

test('frontend seed: UI prices, variant selection and referral survive an API checkout', async () => {
  const s = await consumer();
  const product = (await api.get('/api/v1/shop/products/grip-socks-pink').expect(200)).body;
  assert.equal(product.variants.find((v: any) => v.id === 'pink-m').price, 2295);
  await api.put('/api/v1/shop/cart/items').set(s.headers).send({ productId: product.id, variantId: 'pink-m', quantity: 2 }).expect(200);
  await api.post('/api/v1/referrals/apply').set(s.headers).send({ code: 'MIA10' }).expect(201);
  const order = (await api.post('/api/v1/shop/checkout').set({ ...s.headers, 'Idempotency-Key': randomUUID() }).send({ fulfillment: 'warehouse-collect', source: 'app' }).expect(201)).body;
  assert.equal(order.total, 4590); assert.equal(order.currency, 'AUD');
  assert.equal(order.attribution.code, 'MIA10'); assert.equal(order.attribution.ownerId, 'mia-chen');
  assert.equal(order.paymentRequired, false); assert.equal(order.inventoryUpdated, false);
  assert.equal((await api.get('/api/v1/shop/cart').set(s.headers).expect(200)).body.items.length, 0);
});

test('admin login: fixed credentials issue expiring, revocable tokens; invalid logins are rejected', async () => {
  const credentials = { username: 'admin', password: 'OrbitAdmin123!' };
  await api.post('/api/v1/admin/auth/login').send({ ...credentials, password: 'wrong' }).expect(401);
  await api.post('/api/v1/admin/auth/login').send({ ...credentials, username: 'wrong' }).expect(401);
  const login = (await api.post('/api/v1/admin/auth/login').send(credentials).expect(201)).body;
  assert(login.accessToken); assert(+new Date(login.expiresAt) > Date.now());
  const headers = { Authorization: `Bearer ${login.accessToken}` };
  await api.get('/api/v1/admin/overview').set(headers).expect(200);
  await api.get('/api/v1/shop/cart').set(headers).expect(401);
  const stored = await db.model('AdminSession').findOne().lean();
  assert.notEqual(stored.tokenHash, login.accessToken);
  await api.delete('/api/v1/admin/auth/session').set(headers).expect(200);
  await api.get('/api/v1/admin/overview').set(headers).expect(401);
  const next = (await api.post('/api/v1/admin/auth/login').send(credentials).expect(201)).body;
  await db.model('AdminSession').updateMany({}, { $set: { expiresAt: new Date(0) } });
  await api.get('/api/v1/admin/overview').set({ Authorization: `Bearer ${next.accessToken}` }).expect(401);
});

test('backend content: configuration, active referrals and actual image files populate the mobile UI', async () => {
  const config = (await api.get('/api/v1/config').expect(200)).body;
  assert(config.areas.length); assert(config.interestOptions.length);
  await api.get(config.heroImageUrl).expect('Content-Type', /image\/jpeg/).expect(200);
  const product = (await api.get('/api/v1/shop/products/grip-socks-pink').expect(200)).body;
  assert(product.imageUrl.startsWith('/media/images/'));
  await api.get(product.imageUrl).expect('Content-Type', /image\/png/).expect(200);
  const refs = (await api.get('/api/v1/referrals').expect(200)).body.data;
  assert(refs.some((r: any) => r.code === 'MIA10' && r.owner.name === 'Mia Chen'));
  await api.patch('/api/v1/admin/studios/core-collective').set(admin).send({ name: 'Updated Core From API' }).expect(200);
  assert.equal((await api.get('/api/v1/studios/core-collective').expect(200)).body.name, 'Updated Core From API');
});

test('every seeded image, including legacy records, is served as a native-compatible raster', async () => {
  const { seedData } = require('../dist/seed-data');
  const { uiSeedData } = require('../dist/ui-seed-data');
  for (const data of [seedData, uiSeedData]) for (const [model, records] of Object.entries(data)) {
    for (const record of records as any[]) {
      if (!record.imageUrl) continue;
      const current = await db.model(model).findById(record._id).lean();
      assert(current.imageUrl.startsWith('/media/images/'), record._id);
      await api.get(current.imageUrl).expect('Content-Type', /image\/(jpeg|png|webp)/).expect(200);
    }
  }
});

test('v4 repairs old seed URLs after v3 without replacing custom images or republishing records', async () => {
  const { seedDatabase } = require('../dist/seed');
  await db.model('Studio').updateOne({ _id: 'studio-melbourne' }, { $set: { imageUrl: 'https://placehold.co/800x600?text=Fitzroy%20Demo', published: false } });
  await db.model('Product').updateOne({ _id: 'grip-socks-pink' }, { $set: { imageUrl: 'https://cdn.example.com/custom-pink.png' } });
  await db.model('Seed').deleteOne({ _id: 'orbit-media-v4' });
  assert(await db.model('Seed').exists({ _id: 'orbit-media-v3' }));
  assert.equal((await seedDatabase(db)).seeded, true);
  const studio = await db.model('Studio').findById('studio-melbourne').lean();
  assert.equal(studio.imageUrl, '/media/images/studios/core-collective.jpg');
  assert.equal(studio.published, false);
  assert.equal((await db.model('Product').findById('grip-socks-pink').lean()).imageUrl, 'https://cdn.example.com/custom-pink.png');
  assert.equal((await seedDatabase(db)).seeded, false);
});

test('workout search finds instructor names and returns recommendation context', async () => {
  const result = (await api.get('/api/v1/workouts?search=Mia&format=reformer').expect(200)).body;
  assert(result.data.some((w: any) => w.id === 'reformer-reset' && w.instructors[0].name === 'Mia Chen' && w.studio.id === 'core-collective'));
  assert.equal((await api.get('/api/v1/workouts?search=does-not-exist').expect(200)).body.data.length, 0);
});
