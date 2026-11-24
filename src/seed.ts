import 'reflect-metadata';
import { loadEnvFile } from 'node:process';
import { createConnection, Connection } from 'mongoose';
import { schemas } from './models';
import { legacyImages, seedData } from './seed-data';
import { validateEnv } from './app.module';
import { uiSeedData } from './ui-seed-data';

export async function seedDatabase(db: Connection) {
  for (const [name, schema] of Object.entries(schemas)) if (!db.models[name]) db.model(name, schema);
  await Promise.all(Object.keys(schemas).map(name => db.model(name).init()));
  let seeded = false;
  if (!await db.model('Seed').exists({ _id: 'orbit-mvp-v1' })) {
    for (const [name, records] of Object.entries(seedData)) for (const record of records) {
      const { _id, ...rest } = record;
      await db.model(name).updateOne({ _id }, { $setOnInsert: rest }, { upsert: true, runValidators: true });
    }
    for (const [studioId, instructorId] of [['studio-melbourne', 'instructor-ella'], ['studio-sydney', 'instructor-james']]) {
      await db.model('Affiliation').updateOne({ studioId, instructorId }, { $setOnInsert: { studioId, instructorId } }, { upsert: true });
    }
    await db.model('Seed').updateOne({ _id: 'orbit-mvp-v1' }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true });
    seeded = true;
  }
  if (!await db.model('Seed').exists({ _id: 'orbit-ui-v2' })) {
    for (const [name, records] of Object.entries(uiSeedData)) for (const { _id, ...data } of records) {
      await db.model(name).updateOne({ _id }, { $setOnInsert: data }, { upsert: true, runValidators: true });
    }
    await db.model('Affiliation').updateOne({ studioId: 'core-collective', instructorId: 'mia-chen' }, { $setOnInsert: { studioId: 'core-collective', instructorId: 'mia-chen' } }, { upsert: true });
    await db.model('Seed').updateOne({ _id: 'orbit-ui-v2' }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true });
    seeded = true;
  }
  if (!await db.model('Seed').exists({ _id: 'orbit-media-v3' })) {
    for (const [name, records] of Object.entries(uiSeedData)) for (const record of records) {
      if (!record.imageUrl) continue;
      await db.model(name).updateOne({ _id: record._id, imageUrl: /^https:\/\/placehold\.co\// }, { $set: { imageUrl: record.imageUrl } });
    }
    await db.model('Seed').updateOne({ _id: 'orbit-media-v3' }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true });
    seeded = true;
  }
  if (!await db.model('Seed').exists({ _id: 'orbit-media-v4' })) {
    // Repair both seed generations, even when the old v3 marker is already set.
    // Match the original seed URL exactly so custom/admin artwork is retained.
    for (const [name, records] of Object.entries(seedData)) for (const record of records) {
      if (!record.imageUrl) continue;
      const oldUrls = Object.entries(legacyImages).filter(([, url]) => url === record.imageUrl).map(([url]) => url);
      await db.model(name).updateOne({ _id: record._id, imageUrl: { $in: oldUrls } }, { $set: { imageUrl: record.imageUrl } });
    }
    for (const [name, records] of Object.entries(uiSeedData)) for (const record of records) {
      if (!record.imageUrl) continue;
      const labels: Record<string, string> = { 'core-collective': 'Core Collective', 'pilates-room': 'The Pilates Room', 'form-flow': 'Form and Flow', 'mia-chen': 'Mia Chen', 'grip-socks-pink': 'Sweetie Candy Pink', 'grip-socks-blue': 'Donut Ice Blue', 'yoga-mat-espresso': 'Check Espresso Mat', 'starter-bundle': 'Pilates Starter Bundle', 'reformer-reset': 'Reformer Reset', 'full-body-mat-flow': 'Full Body Mat Flow' };
      const label = labels[record._id];
      const oldUrl = `https://placehold.co/800x600?text=${encodeURIComponent(label + ' Demo')}`;
      await db.model(name).updateOne({ _id: record._id, imageUrl: oldUrl }, { $set: { imageUrl: record.imageUrl } });
    }
    await db.model('Seed').updateOne({ _id: 'orbit-media-v4' }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true });
    seeded = true;
  }
  return { seeded, mode: 'sample-data-only', reason: seeded ? 'Missing seed versions applied' : 'Sample data already seeded; existing edits retained' };
}
async function main() {
  try { loadEnvFile(); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  validateEnv(process.env);
  const db = await createConnection(process.env.MONGODB_URI!, { serverSelectionTimeoutMS: 10000 }).asPromise();
  try { console.log(await seedDatabase(db)); } finally { await db.close(); }
}
if (require.main === module) main().catch(() => { console.error('Seeding failed. Check MongoDB connectivity, credentials and Atlas IP allowlist.'); process.exitCode = 1; });
