/**
 * One-time v2 → v3 cleanup (R15 AC3, design §10.1, tasks T35 / T38).
 * The overall budget is now computed from the members' monthly limits, so the stored overall budgets
 * (`budgets` documents with `categoryId: null`) are retired. This script lists and deletes them.
 *
 *   npm run migrate:v3              (dry run — prints what it would delete)
 *   npm run migrate:v3 -- --apply   (deletes)
 *
 * Database = MONGODB_URI (+ MONGODB_DB_NAME override), exactly like the server. Idempotent: a second run
 * finds nothing. The old amounts are printed so the owner can use them as a guide when setting member limits.
 */
import mongoose from 'mongoose';
import { env } from '../config/env';

const RETIRED = { categoryId: null };

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--apply');
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  const apply = args.includes('--apply');

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    ...(env.MONGODB_DB_NAME ? { dbName: env.MONGODB_DB_NAME } : {}),
  });
  const db = mongoose.connection;
  const budgets = db.collection('budgets');
  const groups = db.collection('groups');
  console.log(`Database: ${db.name}   Mode: ${apply ? 'APPLY (writes!)' : 'dry run (no changes)'}\n`);

  const rows = await budgets.find(RETIRED).toArray();
  for (const row of rows) {
    const group = row.groupId ? await groups.findOne({ _id: row.groupId }) : null;
    console.log(`  overall budget ₹${row.amount}  group: ${group ? `${group.name} (${group.code})` : row.groupId}`);
  }
  console.log(`Stored overall budgets: ${rows.length}`);

  if (!apply) {
    console.log('\nDry run finished — nothing was changed. Re-run with --apply to delete them.');
    return;
  }
  const { deletedCount } = await budgets.deleteMany(RETIRED);
  const left = await budgets.countDocuments(RETIRED);
  console.log(`Deleted: ${deletedCount}   Left: ${left}`);
  if (left) throw new Error('Verification failed — some overall budgets are still there (safe to re-run)');
  console.log('✔ Migration complete. Owners can now set member limits on the Budgets page.');
}

main()
  .catch((err: unknown) => {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
