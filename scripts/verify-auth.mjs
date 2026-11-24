import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const base = 'https://pilates-backend-sigma.vercel.app/api/v1';
const checks = [];
let consumer, admin;
async function request(path, method = 'GET', body, token, expected = 200) {
  const response = await fetch(base + path, { method, signal: AbortSignal.timeout(60000),
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  checks.push({ method, path, status: response.status, expectedStatus: expected });
  assert.equal(response.status, expected, `${method} ${path}: ${result.error?.message || response.status}`);
  return result;
}
try {
  consumer = (await request('/sessions', 'POST', undefined, undefined, 201)).token;
  const signedIn = await request('/auth/login', 'POST', { username: 'staff', password: 'OrbitStaff123!' }, consumer, 201);
  assert.equal(signedIn.accountType, 'staff');
  await request('/admin/overview', 'GET', undefined, consumer, 401);
  assert.equal((await request('/auth/logout', 'POST', undefined, consumer, 201)).accountType, 'guest');
  admin = (await request('/admin/auth/login', 'POST', { username: 'admin', password: 'OrbitAdmin123!' }, undefined, 201)).accessToken;
  await request('/admin/overview', 'GET', undefined, admin);
  await request('/admin/auth/session', 'DELETE', undefined, admin);
  await request('/admin/overview', 'GET', undefined, admin, 401); admin = undefined;
  console.log('Both deployed credentials, role separation and logout passed.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (admin) await request('/admin/auth/session', 'DELETE', undefined, admin).catch(() => {});
  if (consumer) await request('/sessions/me', 'DELETE', undefined, consumer).catch(() => {});
  await writeFile('docs/deployed-auth-verification.json', JSON.stringify({ baseUrl: base, checkedAt: new Date().toISOString(), result: process.exitCode ? 'failed' : 'passed', checks }, null, 2) + '\n');
}
