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
