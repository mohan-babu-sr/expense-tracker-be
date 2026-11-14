/**
 * One-time v3 → v4 step (R17 AC3, design §12.6, tasks T47 / T54).
 * Starts the monthly plan for existing groups: sets `planStartMonth` = the current month on every group that
 * doesn't have one. From that month on, salaries are required before expenses and savings are counted.
 *
 *   npm run migrate:v4              (dry run — lists the groups it would change)
 *   npm run migrate:v4 -- --apply   (writes)
 *
 * Database = MONGODB_URI (+ MONGODB_DB_NAME override), exactly like the server. Idempotent: groups that already
 * have a start month are never touched, so a second run changes 0. New collections (salaries, …) start empty.
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { currentMonth } from '../services/date-utils';

const NOT_STARTED = { planStartMonth: { $exists: false } };

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--apply');
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  const apply = args.includes('--apply');
  const month = currentMonth();

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    ...(env.MONGODB_DB_NAME ? { dbName: env.MONGODB_DB_NAME } : {}),
  });
  const db = mongoose.connection;
  const groups = db.collection('groups');
  console.log(`Database: ${db.name}   Mode: ${apply ? 'APPLY (writes!)' : 'dry run (no changes)'}\n`);

  const rows = await groups.find(NOT_STARTED).toArray();
  for (const row of rows) console.log(`  ${row.name} (${row.code}) → plan starts ${month}`);
  console.log(`Groups without a plan start month: ${rows.length}`);

  if (!apply) {
    console.log('\nDry run finished — nothing was changed. Re-run with --apply to set them.');
    return;
  }
  const { modifiedCount } = await groups.updateMany(NOT_STARTED, { $set: { planStartMonth: month } });
  const left = await groups.countDocuments(NOT_STARTED);
  console.log(`Updated: ${modifiedCount}   Left: ${left}`);
  if (left) throw new Error('Verification failed — some groups still have no start month (safe to re-run)');
  console.log(`✔ Migration complete. Each member must enter their salary for ${month} before adding expenses.`);
}

main()
  .catch((err: unknown) => {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
