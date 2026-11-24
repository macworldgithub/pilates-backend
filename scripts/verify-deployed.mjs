// Exercises only disposable consumer sessions and a simulated order. Seeded
// catalog/admin records are read-only. Never log bearer tokens or credentials.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const base = (process.env.ORBIT_API_URL || 'https://pilates-backend-sigma.vercel.app/api/v1').replace(/\/$/, '');
const checkoutEnabled = process.argv.includes('--checkout');
const reportIndex = process.argv.indexOf('--report');
const checks = [];
let sessionToken, adminToken, otherToken, summary;
async function request(path, { method = 'GET', body, token, status = 200, headers = {} } = {}) {
  const response = await fetch(base + path, {
    method, signal: AbortSignal.timeout(60000),
    headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  checks.push({ method, path, status: response.status, expectedStatus: status });
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(value)}`);
  return value;
}
async function list(path, options) {
  const result = await request(path + (path.includes('?') ? '&' : '?') + 'limit=100', options);
  assert(Array.isArray(result.data), path);
  assert.equal(typeof result.pagination.total, 'number');
  assert.equal(result.pagination.total, result.data.length, `${path}: test expects all seeded records within one page`);
  return result.data;
}
try {
  assert.equal((await request('/health')).database, 'connected');
  const config = await request('/config');
  assert(config.areas.length && config.interestOptions.length);
  assert.equal(config.shop.realCheckout, false);
  assert.equal(config.shop.channel, 'D2C');
  for (const value of Object.values(config.features)) { assert.equal(value, false); }
  const root = base.replace(/\/api\/v1$/, '');
  for (const path of ['/docs', '/docs/openapi.json']) {
    const response = await fetch(root + path, { signal: AbortSignal.timeout(60000) });
    assert.equal(response.status, 200, path);
    if (path.endsWith('.json')) { assert((await response.json()).paths['/api/v1/auth/login']); }
    checks.push({ method: 'GET', path, status: response.status });
  }
  const studios = await list('/studios');
  const workouts = await list('/workouts');
  const products = await list('/shop/products');
  const referrals = await list('/referrals');
  assert(studios.length && workouts.length && products.length && referrals.length, 'Deployed seed catalog is empty');
  assert(studios.some(s => s.id === 'core-collective'));
  assert(products.some(p => p.id === 'grip-socks-pink'));
  const images = new Set([config.heroImageUrl, config.shopHeroImageUrl]);
  const instructors = new Set();
  for (const studio of studios) {
    images.add(studio.imageUrl);
    const detail = await request(`/studios/${studio.id}`);
    assert.equal(detail.id, studio.id); assert(Array.isArray(detail.instructors)); assert(Array.isArray(detail.workouts));
    detail.instructors.forEach(i => instructors.add(i.id));
  }
  for (const id of instructors) {
    const detail = await request(`/instructors/${id}`);
    images.add(detail.imageUrl); assert(detail.studios.length || detail.independent);
    assert(Array.isArray(detail.workouts));
  }
  for (const workout of workouts) {
    const detail = await request(`/workouts/${workout.id}`);
    images.add(detail.imageUrl); assert.equal(detail.studio.id, detail.studioId);
    assert.equal(detail.instructors.length, detail.instructorIds.length);
    assert.equal(detail.products.length, detail.productIds.length);
  }
  for (const product of products) {
    const detail = await request(`/shop/products/${product.id}`);
    images.add(detail.imageUrl); (detail.imageUrls || []).forEach(url => images.add(url));
    assert.equal(detail.bundleProducts.length, detail.bundleProductIds.length);
  }
  for (const url of images) {
    const resolved = new URL(url, root).href;
    const response = await fetch(resolved, { signal: AbortSignal.timeout(60000) });
    assert.equal(response.status, 200, resolved); assert.match(response.headers.get('content-type'), /^image\/(png|jpeg|webp)/);
    await response.arrayBuffer(); checks.push({ method: 'GET', path: new URL(resolved).pathname, status: 200 });
  }
  await request('/shop/collections');
  const area = config.areas[0];
  const near = await list(`/studios?format=reformer&sort=nearest&latitude=${area.latitude}&longitude=${area.longitude}&radiusKm=10`);
  assert(near.length); assert(near.every(s => s.formats.includes('reformer') && s.distanceKm <= 10));
  assert(near.every((s, i) => i === 0 || s.distanceKm >= near[i - 1].distanceKm));
  assert((await list('/workouts?search=Mia&format=reformer')).some(w => w.instructors.some(i => i.name === 'Mia Chen')));
  assert.equal((await list('/studios?search=orbit-no-match-92')).length, 0);
  assert.equal((await list('/shop/products?search=orbit-no-match-92')).length, 0);
  assert.equal((await list('/offers')).length, 0);
  await list(`/offers?latitude=${area.latitude}&longitude=${area.longitude}`);
  await request('/shop/cart', { status: 401 }); await request('/admin/overview', { status: 401 });
  const created = await request('/sessions', { method: 'POST', status: 201 });
  sessionToken = created.token; assert(sessionToken);
  const session = await request('/sessions/me', { token: sessionToken }); assert.equal(session.id, created.id);
  const profile = { ...area, interests: [config.interestOptions[0].value], formats: ['reformer'], onboardingComplete: true };
  assert.deepEqual((await request('/sessions/me', { method: 'PATCH', body: profile, token: sessionToken })).profile, profile);
  await request('/auth/login', { method: 'POST', body: { username: 'staff', password: 'invalid' }, token: sessionToken, status: 401 });
  const staff = await request('/auth/login', { method: 'POST', body: { username: 'staff', password: 'OrbitStaff123!' }, token: sessionToken, status: 201 });
  assert.equal(staff.accountType, 'staff'); assert.deepEqual(staff.profile, profile);
  await request('/admin/overview', { token: sessionToken, status: 401 });
  assert.equal((await request('/auth/logout', { method: 'POST', token: sessionToken, status: 201 })).accountType, 'guest');
  const itemProduct = products.find(p => p.id === 'grip-socks-pink') || products.find(p => p.variants.some(v => v.available));
  const variant = itemProduct.variants.find(v => v.available); assert(variant);
  const item = { productId: itemProduct.id, variantId: variant.id, quantity: 2 };
  assert.equal((await request('/shop/cart', { token: sessionToken })).items.length, 0);
  const cart = await request('/shop/cart/items', { method: 'PUT', body: item, token: sessionToken });
  assert.equal(cart.subtotal, variant.price * 2);
  await request(`/shop/cart/items/${item.productId}/${item.variantId}`, { method: 'DELETE', token: sessionToken });
  await request('/shop/cart/items', { method: 'PUT', body: item, token: sessionToken });
  const referral = await request(`/referrals/${referrals[0].code}`); assert.equal(referral.commissionsEnabled, false);
  await request('/referrals/apply', { method: 'POST', body: { code: referral.code }, token: sessionToken, status: 201 });
  assert.equal((await request('/sessions/me', { token: sessionToken })).referralCode, referral.code);
  await request('/events', { method: 'POST', body: { name: 'product_opened', source: 'app', entityId: itemProduct.id }, token: sessionToken, status: 201 });
  const input = { fulfillment: 'warehouse-collect', source: 'app', discountCode: 'WELCOME15' };
  const quote = await request('/shop/checkout/quote', { method: 'POST', body: input, token: sessionToken, status: 201 });
  assert.equal(quote.subtotal, variant.price * 2); assert.equal(quote.shipping, 0);
  assert.equal(quote.total, quote.subtotal - quote.discount); assert.equal(quote.attribution.code, referral.code);
  await request('/shop/checkout/quote', { method: 'POST', body: { fulfillment: 'delivery', source: 'app', discountCode: 'SEASON10' }, token: sessionToken, status: 201 });
  let orderId;
  if (checkoutEnabled) {
    const headers = { 'Idempotency-Key': `audit-${randomUUID()}` };
    const order = await request('/shop/checkout', { method: 'POST', body: input, token: sessionToken, headers, status: 201 });
    orderId = order.id; assert.equal(order.total, quote.total); assert.equal(order.paymentRequired, false); assert.equal(order.inventoryUpdated, false);
    const replay = await request('/shop/checkout', { method: 'POST', body: input, token: sessionToken, headers, status: 201 });
    assert.equal(replay.id, order.id);
    await request('/shop/checkout', { method: 'POST', body: { ...input, fulfillment: 'delivery' }, token: sessionToken, headers, status: 409 });
    assert.equal((await request('/shop/cart', { token: sessionToken })).items.length, 0);
    assert((await list('/shop/orders', { token: sessionToken })).some(o => o.id === order.id));
    await request(`/shop/orders/${order.id}`, { token: sessionToken });
    otherToken = (await request('/sessions', { method: 'POST', status: 201 })).token;
    await request(`/shop/orders/${order.id}`, { token: otherToken, status: 404 });
  }
  await request('/shop/cart', { method: 'DELETE', token: sessionToken });
  await request('/admin/auth/login', { method: 'POST', body: { username: 'admin', password: 'invalid' }, status: 401 });
  adminToken = (await request('/admin/auth/login', { method: 'POST', body: { username: 'admin', password: 'OrbitAdmin123!' }, status: 201 })).accessToken;
  assert(adminToken);
  const overview = await request('/admin/overview', { token: adminToken }); assert.equal(overview.mode, 'simulated');
  for (const kind of ['studios', 'instructors', 'workouts', 'products', 'referrals', 'offers', 'affiliations']) {
    const result = await list(`/admin/${kind}`, { token: adminToken });
    if (result[0] && kind !== 'affiliations') { await request(`/admin/${kind}/${result[0].id}`, { token: adminToken }); }
  }
  for (const kind of ['events', 'audit', 'orders']) { await request(`/admin/activity/${kind}?limit=1`, { token: adminToken }); }
  await request('/shop/cart', { token: adminToken, status: 401 });
  await request('/admin/auth/session', { method: 'DELETE', token: adminToken });
  await request('/admin/overview', { token: adminToken, status: 401 }); adminToken = undefined;
  summary = { baseUrl: base, checkedAt: new Date().toISOString(), result: 'passed', requestCount: checks.length,
    catalog: { studios: studios.length, instructors: instructors.size, workouts: workouts.length, products: products.length, referrals: referrals.length, images: images.size },
    simulatedCheckoutVerified: checkoutEnabled, ...(orderId ? { demoOrderId: orderId } : {}), seededRecordsModified: false, checks };
} catch (error) {
  summary = { baseUrl: base, checkedAt: new Date().toISOString(), result: 'failed', requestCount: checks.length, message: error.message, simulatedCheckoutVerified: false, seededRecordsModified: false, checks };
  process.exitCode = 1;
} finally {
  if (adminToken) { await request('/admin/auth/session', { method: 'DELETE', token: adminToken }).catch(() => {}); }
  for (const token of [sessionToken, otherToken].filter(Boolean)) {
    await request('/sessions/me', { method: 'DELETE', token }).catch(() => {});
    await request('/sessions/me', { token, status: 401 }).catch(() => {});
  }
  if (summary) {
    summary.requestCount = checks.length;
    console.log(JSON.stringify({ ...summary, checks: undefined }, null, 2));
    if (reportIndex !== -1) { await writeFile(process.argv[reportIndex + 1], JSON.stringify(summary, null, 2) + '\n'); }
  }
}
