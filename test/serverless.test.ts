import 'reflect-metadata';
import { after, before, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import request from 'supertest';

let repl: MongoMemoryReplSet, entry: any, serverless: any, app: any, recovered: any;
let create: ReturnType<typeof mock.method>;
before(async () => {
  process.env.MONGOMS_DOWNLOAD_DIR = resolve('.cache/mongodb-binaries');
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = repl.getUri('orbit_serverless_test');
  process.env.NODE_ENV = 'test';
  process.env.VERCEL = '1';
  delete process.env.ADMIN_TOKEN;
  process.env.CORS_ORIGINS = 'http://localhost:8081';
  create = mock.method(NestFactory, 'create');
  entry = require('../api/index');
  serverless = require('../dist/serverless');
}, { timeout: 180000 });
after(async () => {
  mock.restoreAll();
  if (app) await app.close();
  if (recovered) await recovered.close();
  if (repl) await repl.stop();
});

test('Vercel entry shares one initialization and bounded database pool across concurrent and warm requests', async () => {
  const results = await Promise.all([
    request(entry).get('/api/v1/health').expect(200),
    request(entry).get('/api/v1/config').expect(200),
    request(entry).get('/api/v1/health').expect(200),
  ]);
  assert.equal(results[0].body.database, 'connected');
  assert.equal(create.mock.callCount(), 1);
  app = await serverless.getApplication();
  assert.equal(app.getHttpServer().listening, false, 'the function must not open a persistent listener');
  const db = app.get(getConnectionToken());
  assert.equal(app.get(require('@nestjs/config').ConfigService).get('ADMIN_TOKEN'), undefined, 'Vercel must not load local dotenv secrets');
  assert.equal(await db.model('Seed').countDocuments(), 0, 'cold starts must never seed the database');
  const options = db.getClient().options;
  assert.equal(options.maxPoolSize, 10);
  assert.equal(options.minPoolSize, 0);
  assert.equal(options.maxIdleTimeMS, 60000);
  await request(entry).get('/api/v1/health').expect(200);
  assert.equal(await serverless.getApplication(), app);
  assert.equal(create.mock.callCount(), 1);
  await require('../dist/seed').seedDatabase(db);
});

test('deployed entry preserves JSON validation, session auth, queries and a complete demo checkout', async () => {
  const api = request(entry);
  const session = (await api.post('/api/v1/sessions').expect(201)).body;
  const headers = { Authorization: `Bearer ${session.token}` };
  await api.get('/api/v1/shop/cart').expect(401);
  await api.put('/api/v1/shop/cart/items').set(headers).send({ productId: 'grip-socks-pink', variantId: 'pink-m', quantity: 1 }).expect(200);
  await api.put('/api/v1/shop/cart/items').set(headers).send({ productId: 'grip-socks-pink', variantId: 'pink-m', quantity: 0 }).expect(400);
  const input = { fulfillment: 'warehouse-collect', source: 'app' };
  const quote = (await api.post('/api/v1/shop/checkout/quote').set(headers).send(input).expect(201)).body;
  assert.equal(quote.total, 2295);
  const result = (await api.post('/api/v1/shop/checkout').set({ ...headers, 'Idempotency-Key': 'serverless-checkout-001' }).send(input).expect(201)).body;
  assert.equal(result.status, 'demo-confirmed');
  assert.equal((await api.get('/api/v1/shop/cart').set(headers).expect(200)).body.items.length, 0);
  const search = (await api.get('/api/v1/workouts?search=Mia&format=reformer').expect(200)).body;
  assert(search.data.some((w: any) => w.id === 'reformer-reset'));
  await api.get('/api/v1/admin/overview').set(headers).expect(401);
});

test('Vercel entry preserves docs, media, preflight and the JSON body limit', async () => {
  const api = request(entry);
  await api.get('/docs').expect('Content-Type', /text\/html/).expect(200);
  await api.get('/docs/swagger-ui.css').expect('Content-Type', /text\/css/).expect(200);
  const document = (await api.get('/docs/openapi.json').expect(200)).body;
  assert(document.paths['/api/v1/studios']);
  await api.get('/media/images/products/grip-socks-pink.png').expect('Content-Type', /image\/png/).expect(200);
  await api.options('/api/v1/shop/cart').set('Origin', 'http://localhost:8081').set('Access-Control-Request-Method', 'PUT').set('Access-Control-Request-Headers', 'authorization,content-type').expect('Access-Control-Allow-Origin', 'http://localhost:8081').expect(204);
  await api.post('/api/v1/sessions').set('Content-Type', 'application/json').send('{').expect(400);
  await api.post('/api/v1/sessions').send({ oversized: 'x'.repeat(70 * 1024) }).expect(413);
  await api.get('/api/v1/not-a-route').expect(404);
});

test('Vercel rewrite metadata does not break catalog, personal or admin list validation', async () => {
  const api = request(entry);
  const studios = (await api.get('/api/v1/studios?path=api%2Fv1%2Fstudios&format=reformer&limit=100').expect(200)).body;
  assert(studios.data.length);
  assert(studios.data.every((s: any) => s.formats.includes('reformer')));
  const workouts = (await api.get('/api/v1/workouts?path=api/v1/workouts&search=Mia&format=reformer').expect(200)).body;
  assert(workouts.data.some((w: any) => w.id === 'reformer-reset'));
  await api.get('/api/v1/shop/products?path=api/v1/shop/products&collection=grip-socks').expect(200);
  await api.get('/api/v1/referrals?path=api/v1/referrals').expect(200);
  await api.get('/api/v1/offers?path=api/v1/offers').expect(200);
  // Removing routing metadata must not weaken validation for actual API input.
  await api.get('/api/v1/studios?path=api/v1/studios&format=invalid').expect(400);
  await api.get('/api/v1/studios?path=api/v1/studios&unexpected=value').expect(400);
  const session = (await api.post('/api/v1/sessions?path=api/v1/sessions').expect(201)).body;
  await api.get('/api/v1/shop/orders?path=api/v1/shop/orders').set('Authorization', `Bearer ${session.token}`).expect(200);
  const admin = (await api.post('/api/v1/admin/auth/login?path=api/v1/admin/auth/login').send({ username: 'admin', password: 'OrbitAdmin123!' }).expect(201)).body;
  await api.get('/api/v1/admin/studios?path=api/v1/admin/studios').set('Authorization', `Bearer ${admin.accessToken}`).expect(200);
});

test('Vercel materialized query metadata is removed while real filter values survive', async () => {
  const adapter = (req: any, res: any) => {
    Object.defineProperty(req, 'query', { value: { path: ['api', 'v1', 'studios'], format: 'mat', limit: '100' }, configurable: true });
    return entry(req, res);
  };
  const result = (await request(adapter).get('/api/v1/studios?format=mat&limit=100').expect(200)).body;
  assert(result.data.length);
  assert(result.data.every((s: any) => s.formats.includes('mat')));
});

test('a cold-start failure responds safely and a later request retries initialization', async () => {
  // Load an independent function instance while leaving its real application factory intact.
  delete require.cache[require.resolve('../dist/serverless')];
  delete require.cache[require.resolve('../api/index')];
  const main = require('../dist/main');
  const factory = mock.method(main, 'createApplication');
  factory.mock.mockImplementationOnce(async () => { throw new Error('mongodb://private:secret@database.invalid'); });
  const retryEntry = require('../api/index');
  const failed = await request(retryEntry).get('/api/v1/health').expect('Cache-Control', 'no-store').expect('Retry-After', '5').expect(503);
  assert(!JSON.stringify(failed.body).includes('secret'));
  await request(retryEntry).get('/api/v1/health').expect(200);
  recovered = await require('../dist/serverless').getApplication();
  assert.equal(factory.mock.callCount(), 2);
  factory.mock.restore();
});
