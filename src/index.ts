import mongoose from 'mongoose';
import { env } from './config/env'; // first import: loads & validates .env
import { connectDb } from './config/db';
import { createApp } from './app';
import { seedAdmin } from './services/seed';

/**
 * Makes the database indexes match the schemas exactly (design §8.4): creates missing indexes and DROPS
 * old ones — e.g. v1's unique `nameLower_1` on categories, which would stop two groups both having "Food".
 */
async function syncIndexes(): Promise<void> {
  const dropped = await mongoose.syncIndexes();
  for (const [model, names] of Object.entries(dropped)) {
    if (Array.isArray(names) && names.length) console.log(`Indexes: dropped old ${model} indexes ${names.join(', ')}`);
  }
}

// Start-up order (design §3, §8): env → connect DB → sync indexes → seed admin → listen.
// (Default categories are now seeded per group when a group is created — R13 AC10.)
async function main(): Promise<void> {
  await connectDb(env.MONGODB_URI, env.MONGODB_DB_NAME, env.NODE_ENV === 'production');
  await syncIndexes();
  await seedAdmin(env.ADMIN_INITIAL_PASSWORD);

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}/api`);
  });
}

main().catch((err: unknown) => {
  console.error('❌ Failed to start server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
