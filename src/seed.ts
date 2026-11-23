import 'reflect-metadata';
import { loadEnvFile } from 'node:process';
import { createConnection, Connection } from 'mongoose';
import { schemas } from './models';
import { seedData } from './seed-data';
import { validateEnv } from './app.module';

export async function seedDatabase(db: Connection) {
  for (const [name, schema] of Object.entries(schemas)) if (!db.models[name]) db.model(name, schema);
  await Promise.all(Object.keys(schemas).map(name => db.model(name).init()));
  if (await db.model('Seed').exists({ _id: 'orbit-mvp-v1' })) return { seeded: false, reason: 'Sample data was already seeded; existing edits retained' };
  for (const [name, records] of Object.entries(seedData)) for (const record of records) {
    const { _id, ...rest } = record;
    await db.model(name).updateOne({ _id }, { $setOnInsert: rest }, { upsert: true, runValidators: true });
  }
  for (const [studioId, instructorId] of [['studio-melbourne', 'instructor-ella'], ['studio-sydney', 'instructor-james']]) {
    await db.model('Affiliation').updateOne({ studioId, instructorId }, { $setOnInsert: { studioId, instructorId } }, { upsert: true });
  }
  await db.model('Seed').updateOne({ _id: 'orbit-mvp-v1' }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true });
  return { seeded: true, mode: 'sample-data-only' };
}
async function main() {
  try { loadEnvFile(); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  validateEnv(process.env);
  const db = await createConnection(process.env.MONGODB_URI!, { serverSelectionTimeoutMS: 10000 }).asPromise();
  try { console.log(await seedDatabase(db)); } finally { await db.close(); }
}
if (require.main === module) main().catch(() => { console.error('Seeding failed. Check MongoDB connectivity, credentials and Atlas IP allowlist.'); process.exitCode = 1; });
