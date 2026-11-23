import 'reflect-metadata';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

let repl: MongoMemoryReplSet, app: any, db: any, api: any, token: string, secondToken: string;
const adminToken = 'test-admin-token-that-is-longer-than-32-characters';
const auth = () => ({ Authorization: `Bearer ${token}` });
const admin = () => ({ Authorization: `Bearer ${adminToken}` });
const checkout = { fulfillment: 'warehouse-collect', source: 'app', discountCode: 'WELCOME15' };
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR = resolve('.cache/mongodb-binaries');
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = repl.getUri('orbit_test');
  process.env.ADMIN_TOKEN = adminToken;
  process.env.NODE_ENV = 'test';
  const { AppModule } = require('../dist/app.module');
  const { configure } = require('../dist/common');
  const { seedDatabase } = require('../dist/seed');
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication({ logger: false });
  configure(app, ['http://localhost:8081']);
  await app.init();
  db = app.get(getConnectionToken());
  await seedDatabase(db);
  api = request(app.getHttpServer());
  token = (await api.post('/api/v1/sessions').expect(201)).body.token;
  secondToken = (await api.post('/api/v1/sessions').expect(201)).body.token;
}, { timeout: 180000 });
after(async () => { if (app) await app.close(); if (repl) await repl.stop(); });

test('health and scope expose a connected, simulated backend', async () => {
  assert.equal((await api.get('/api/v1/health').expect(200)).body.database, 'connected');
  const config = (await api.get('/api/v1/config').expect(200)).body;
  assert.equal(config.shop.realCheckout, false); assert.equal(config.features.commissions, false);
});
test('onboarding persists location, formats and interests; invalid completion is rejected', async () => {
  await api.patch('/api/v1/sessions/me').set(auth()).send({ onboardingComplete: true }).expect(400);
  const profile = { area: 'Fitzroy', formats: ['mat'], interests: ['strength'], onboardingComplete: true };
  await api.patch('/api/v1/sessions/me').set(auth()).send(profile).expect(200);
  assert.deepEqual((await api.get('/api/v1/sessions/me').set(auth()).expect(200)).body.profile, profile);
  await api.patch('/api/v1/sessions/me').set(auth()).send({ latitude: -37 }).expect(400);
  await api.patch('/api/v1/sessions/me').set(auth()).send({ role: 'admin' }).expect(400);
  await api.patch('/api/v1/sessions/me').set(auth()).send({ latitude: null, longitude: null }).expect(400);
});
test('studio nearest search, format and radius filters work', async () => {
  const studios = (await api.get('/api/v1/studios?format=reformer&latitude=-37.798&longitude=144.978&radiusKm=20&sort=nearest').expect(200)).body;
  assert.equal(studios.data.length, 1); assert.equal(studios.data[0].id, 'studio-melbourne'); assert.equal(studios.data[0].distanceKm, 0);
  await api.get('/api/v1/studios?latitude=0').expect(400);
  await api.get('/api/v1/studios?sort=nearest').expect(400);
  await api.get('/api/v1/studios?limit=500').expect(400);
});
test('studio -> instructor -> workout -> tagged bundle journey', async () => {
  const studio = (await api.get('/api/v1/studios/studio-melbourne').expect(200)).body;
  assert.equal(studio.instructors[0].id, 'instructor-ella');
  assert.equal(studio.referrals[0].code, 'FITZROY-DEMO');
  const instructor = (await api.get('/api/v1/instructors/instructor-ella').expect(200)).body;
  assert.equal(instructor.studios[0].id, studio.id);
  assert.equal(instructor.referrals[0].code, 'ELLA-DEMO');
  const workout = (await api.get('/api/v1/workouts/workout-mat').expect(200)).body;
  assert(workout.products.some((p: any) => p.id === 'product-bundle'));
  const bundle = (await api.get('/api/v1/shop/products/product-bundle').expect(200)).body;
  assert.equal(bundle.bundleProducts.length, 2);
  const workouts = (await api.get('/api/v1/workouts?format=mat&interest=mobility').expect(200)).body;
  assert.equal(workouts.data.length, 2);
  assert(+new Date(workouts.data[0].publishedAt) >= +new Date(workouts.data[1].publishedAt));
  await api.get('/api/v1/instructors/instructor-alex').expect(404);
});
test('geo offers require location and eligible nearby partner', async () => {
  assert.equal((await api.get('/api/v1/offers').expect(200)).body.data.length, 0);
  assert.equal((await api.get('/api/v1/offers?latitude=-37.798&longitude=144.978').expect(200)).body.data.length, 1);
  assert.equal((await api.get('/api/v1/offers?latitude=51&longitude=0').expect(200)).body.data.length, 0);
});
test('admin and sessions are separate authorization boundaries', async () => {
  await api.get('/api/v1/admin/overview').expect(401);
  await api.get('/api/v1/admin/overview').set(auth()).expect(401);
  await api.get('/api/v1/shop/cart').set(admin()).expect(401);
  await api.get('/api/v1/admin/overview').set(admin()).expect(200);
});
test('admin creates, updates and archives resources with strict validation', async () => {
  const body = { name: 'New Sample', bio: 'Sample studio instructor', imageUrl: 'https://example.com/image.jpg', independent: false, approvalStatus: 'approved', published: true };
  const created = (await api.post('/api/v1/admin/instructors').set(admin()).send(body).expect(201)).body;
  await api.get(`/api/v1/instructors/${created.id}`).expect(404);
  await api.post('/api/v1/admin/affiliations').set(admin()).send({ studioId: 'studio-melbourne', instructorId: created.id }).expect(201);
  await api.get(`/api/v1/instructors/${created.id}`).expect(200);
  const updated = (await api.patch(`/api/v1/admin/instructors/${created.id}`).set(admin()).send({ name: 'Updated Sample' }).expect(200)).body;
  assert.equal(updated.name, 'Updated Sample');
  await api.patch(`/api/v1/admin/instructors/${created.id}`).set(admin()).send({ name: null }).expect(400);
  await api.patch(`/api/v1/admin/instructors/${created.id}`).set(admin()).send({ administrator: true }).expect(400);
  await api.delete(`/api/v1/admin/instructors/${created.id}`).set(admin()).expect(200);
  await api.get(`/api/v1/instructors/${created.id}`).expect(404);
});
test('admin enforces independent approval, affiliation and partner offer rules', async () => {
  await api.patch('/api/v1/admin/instructors/instructor-alex').set(admin()).send({ published: true }).expect(400);
  await api.post('/api/v1/admin/affiliations').set(admin()).send({ studioId: 'missing', instructorId: 'instructor-ella' }).expect(400);
  await api.post('/api/v1/admin/offers').set(admin()).send({ studioId: 'studio-london', title: 'Offer', description: 'Not eligible', radiusKm: 10, active: true, expiresAt: '2030-01-01T00:00:00Z' }).expect(400);
  await api.patch('/api/v1/admin/studios/studio-melbourne').set(admin()).send({ partnerType: 'listed' }).expect(400);
  await api.delete('/api/v1/admin/affiliations/studio-melbourne/instructor-ella').set(admin()).expect(400);
});
test('cart rejects unavailable variants, negative quantities and client pricing', async () => {
  await api.put('/api/v1/shop/cart/items').set(auth()).send({ productId: 'product-socks', variantId: 'socks-l', quantity: 1 }).expect(400);
  await api.put('/api/v1/shop/cart/items').set(auth()).send({ productId: 'product-socks', variantId: 'socks-s', quantity: -1 }).expect(400);
  await api.put('/api/v1/shop/cart/items').set(auth()).send({ productId: 'product-socks', variantId: 'socks-s', quantity: 1, price: 1 }).expect(400);
  await api.put('/api/v1/shop/cart/items').set(auth()).send({ productId: 'product-socks', variantId: 'socks-s', quantity: 2 }).expect(200);
  const cart = (await api.get('/api/v1/shop/cart').set(auth()).expect(200)).body;
  assert.equal(cart.subtotal, 4400);
  assert.equal((await api.get('/api/v1/shop/cart').set({ Authorization: `Bearer ${secondToken}` }).expect(200)).body.items.length, 0);
});
test('referral attribution, server prices and welcome discount reach simulated order', async () => {
  await api.post('/api/v1/referrals/apply').set(auth()).send({ code: 'FITZROY-DEMO' }).expect(201);
  const quote = (await api.post('/api/v1/shop/checkout/quote').set(auth()).send(checkout).expect(201)).body;
  assert.equal(quote.discount, 660); assert.equal(quote.total, 3740); assert.equal(quote.attribution.code, 'FITZROY-DEMO');
  const key = randomUUID();
  const order = (await api.post('/api/v1/shop/checkout').set({ ...auth(), 'Idempotency-Key': key }).send(checkout).expect(201)).body;
  assert.equal(order.status, 'demo-confirmed'); assert.equal(order.paymentRequired, false); assert.equal(order.inventoryUpdated, false);
  const retry = (await api.post('/api/v1/shop/checkout').set({ ...auth(), 'Idempotency-Key': key }).send(checkout).expect(201)).body;
  assert.equal(retry.id, order.id);
  await api.post('/api/v1/shop/checkout').set({ ...auth(), 'Idempotency-Key': key }).send({ ...checkout, source: 'web' }).expect(409);
  await api.get(`/api/v1/shop/orders/${order.id}`).set({ Authorization: `Bearer ${secondToken}` }).expect(404);
  assert.equal((await api.get('/api/v1/shop/cart').set(auth()).expect(200)).body.items.length, 0);
  assert.equal(await db.model('Order').countDocuments(), 1);
  assert.equal((await db.model('Product').findById('product-socks').lean()).variants[0].available, true);
  await api.put('/api/v1/shop/cart/items').set(auth()).send({ productId: 'product-ball', variantId: 'ball-sage', quantity: 1 }).expect(200);
  await api.post('/api/v1/shop/checkout/quote').set(auth()).send(checkout).expect(400);
});
test('concurrent checkout retries create one order and clear the cart once', async () => {
  const key = randomUUID();
  const headers = { Authorization: `Bearer ${secondToken}`, 'Idempotency-Key': key };
  await api.put('/api/v1/shop/cart/items').set(headers).send({ productId: 'product-bundle', variantId: 'bundle-sage', quantity: 1 }).expect(200);
  const results = await Promise.all([api.post('/api/v1/shop/checkout').set(headers).send(checkout), api.post('/api/v1/shop/checkout').set(headers).send(checkout)]);
  assert.deepEqual(results.map(r => r.status), [201, 201]);
  assert.equal(results[0].body.id, results[1].body.id);
  assert.equal(await db.model('Order').countDocuments(), 2);
});
test('events are stored locally with source and restricted metadata', async () => {
  await api.post('/api/v1/events').set(auth()).send({ name: 'workout_opened', source: 'app', entityId: 'workout-mat' }).expect(201);
  await api.post('/api/v1/events').set(auth()).send({ name: 'arbitrary', source: 'app' }).expect(400);
  assert((await api.get('/api/v1/admin/activity/events').set(admin()).expect(200)).body.data.some((e: any) => e.name === 'workout_opened'));
});
test('seeding twice retains admin changes and archived sample content', async () => {
  const { seedDatabase } = require('../dist/seed');
  await api.patch('/api/v1/admin/studios/studio-london').set(admin()).send({ name: 'Edited Sample London' }).expect(200);
  assert.equal((await seedDatabase(db)).seeded, false);
  assert.equal((await api.get('/api/v1/admin/studios/studio-london').set(admin()).expect(200)).body.name, 'Edited Sample London');
});
test('expired and revoked session tokens cannot access personal data', async () => {
  const created = (await api.post('/api/v1/sessions').expect(201)).body;
  await db.model('Session').updateOne({ _id: created.id }, { $set: { expiresAt: new Date(0) } });
  await api.get('/api/v1/sessions/me').set({ Authorization: `Bearer ${created.token}` }).expect(401);
  await api.delete('/api/v1/sessions/me').set({ Authorization: `Bearer ${secondToken}` }).expect(200);
  await api.get('/api/v1/shop/cart').set({ Authorization: `Bearer ${secondToken}` }).expect(401);
});
