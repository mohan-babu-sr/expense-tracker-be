/**
 * One-time v1 → v2 migration (R13 AC11, design §8.4, tasks T27 / T31).
 * Moves every document WITHOUT a groupId (= v1 data) into one group, and maps the legacy `user` names
 * ("Mohan", "Abhinaya") to real user accounts.
 *
 *   npm run migrate:v2 -- --code HOME-2026 --map Mohan=98xxxxxxxx --map Abhinaya=97xxxxxxxx           (dry run)
 *   npm run migrate:v2 -- --code HOME-2026 --map Mohan=98xxxxxxxx --map Abhinaya=97xxxxxxxx --apply   (writes)
 *
 * Database = MONGODB_URI (+ MONGODB_DB_NAME override), exactly like the server. Run it AFTER the group and the
 * mapped accounts exist (created in the app / admin panel). Idempotent: a second run finds nothing to move.
 *
 * Steps
 *  1. Categories: a v1 category and a category of the group with the same name → the v1 one wins; expenses /
 *     budgets of the group's copy are moved onto it, then the copy is deleted. Re-seeded defaults that didn't
 *     exist in v1 (deleted back then) and are unused are removed. Then all v1 categories get the groupId.
 *  2. Expenses: groupId + userId from --map (legacy `user` field removed); missing / unmapped → group owner.
 *  3. Budgets: groupId; if the group already has a budget for the same category, the group's (newer) one is kept.
 *
 * Uses raw collections (not models): the models no longer know the legacy `user` field, and the script must see
 * the data exactly as stored.
 */
import mongoose, { Types } from 'mongoose';
import { env } from '../config/env';
import { normalizeMobile } from '../validators/auth.schema';

const LEGACY = { groupId: { $exists: false } }; // v1 documents never had the field

function parseArgs() {
  const args = process.argv.slice(2);
  const value = (i: number, name: string) => {
    const v = args[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`Missing value after ${name}`);
    return v;
  };
  let code: string | undefined;
  const map = new Map<string, string>(); // legacy name → mobile
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--code') code = value(i++, '--code');
    else if (args[i] === '--map') {
      const [name, mobile] = value(i++, '--map').split('=');
      if (!name || !mobile) throw new Error('--map must look like Name=mobile, e.g. --map Mohan=9876543210');
      map.set(name, normalizeMobile(mobile));
    } else if (args[i] === '--apply') apply = true;
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (!code) throw new Error('Missing --code <group code>');
  return { code, map, apply };
}

async function main(): Promise<void> {
  const { code, map, apply } = parseArgs();
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    ...(env.MONGODB_DB_NAME ? { dbName: env.MONGODB_DB_NAME } : {}),
  });
  const db = mongoose.connection;
  const col = {
    groups: db.collection('groups'),
    users: db.collection('users'),
    categories: db.collection('categories'),
    expenses: db.collection('expenses'),
    budgets: db.collection('budgets'),
  };
  console.log(`Database: ${db.name}   Mode: ${apply ? 'APPLY (writes!)' : 'dry run (no changes)'}\n`);

  // ---------- preconditions ----------
  const group = await col.groups.findOne({ codeLower: code.toLowerCase() });
  if (!group) throw new Error(`No group with code "${code}" — create it in the app first`);
  const groupId = group._id as Types.ObjectId;

  const owner =
    (await col.users.findOne({ groupId, role: 'owner', status: 'active' })) ??
    (await col.users.findOne({ groupId, status: 'active' }, { sort: { createdAt: 1 } }));
  if (!owner) throw new Error('The group has no active member yet — add the accounts first');

  const userIdByName = new Map<string, Types.ObjectId>();
  for (const [name, mobile] of map) {
    const u = await col.users.findOne({ mobile, groupId, status: 'active' });
    if (!u) throw new Error(`--map ${name}=${mobile}: no ACTIVE member of "${code}" with that mobile`);
    userIdByName.set(name, u._id as Types.ObjectId);
  }
  console.log(`Group "${group.name}" (${group.code}); unmapped/missing spender → ${owner.name}`);

  const legacyCounts = {
    categories: await col.categories.countDocuments(LEGACY),
    expenses: await col.expenses.countDocuments(LEGACY),
    budgets: await col.budgets.countDocuments(LEGACY),
  };
  console.log(`To migrate: ${JSON.stringify(legacyCounts)}`);
  if (!legacyCounts.categories && !legacyCounts.expenses && !legacyCounts.budgets) {
    console.log('Nothing to migrate — already done.');
    return;
  }
  const sum = async (filter: object) =>
    (await col.expenses.aggregate([{ $match: filter }, { $group: { _id: null, t: { $sum: '$amount' } } }]).toArray())[0]
      ?.t ?? 0;
  const legacyTotal = await sum({ ...LEGACY, deletedAt: null });
  const groupTotalBefore = await sum({ groupId, deletedAt: null });

  // ---------- 1. categories ----------
  const legacyCats = await col.categories.find(LEGACY).toArray();
  const groupCats = await col.categories.find({ groupId }).toArray();
  const legacyByName = new Map(legacyCats.map((c) => [c.nameLower as string, c]));

  for (const gc of groupCats) {
    const v1 = legacyByName.get(gc.nameLower as string);
    const used = await col.expenses.countDocuments({ categoryId: gc._id });
    const budgeted = await col.budgets.countDocuments({ categoryId: gc._id });

    if (v1) {
      console.log(`  category "${gc.name}": keep v1 version; move ${used} expense(s), ${budgeted} budget(s) from the group's copy`);
      if (!apply) continue;
      await col.expenses.updateMany({ categoryId: gc._id }, { $set: { categoryId: v1._id } });
      const gBudget = await col.budgets.findOne({ categoryId: gc._id });
      if (gBudget) {
        // The v1 category's legacy budget (if any) is dropped in step 3 in favour of this newer one.
        await col.budgets.updateOne({ _id: gBudget._id }, { $set: { categoryId: v1._id } });
      }
      await col.categories.deleteOne({ _id: gc._id });
    } else if (gc.isDefault && !gc.isSystem && used === 0 && budgeted === 0) {
      console.log(`  category "${gc.name}": not in v1 (deleted there) and unused → remove`);
      if (apply) await col.categories.deleteOne({ _id: gc._id });
    } else {
      console.log(`  category "${gc.name}": only in the group → keep`);
    }
  }
  console.log(`  ${legacyCats.length} v1 categories → group`);
  if (apply) await col.categories.updateMany(LEGACY, { $set: { groupId } });

  // ---------- 2. expenses ----------
  const byUser = await col.expenses
    .aggregate<{ _id: string | null; n: number }>([{ $match: LEGACY }, { $group: { _id: '$user', n: { $sum: 1 } } }])
    .toArray();
  for (const row of byUser) {
    const target = (row._id && userIdByName.has(row._id)) ? row._id : `${owner.name} (owner — ${row._id ? 'not in --map' : 'no user'})`;
    console.log(`  expenses user=${JSON.stringify(row._id)}: ${row.n} → ${target}`);
  }
  if (apply) {
    for (const [name, userId] of userIdByName) {
      await col.expenses.updateMany({ ...LEGACY, user: name }, { $set: { groupId, userId }, $unset: { user: '' } });
    }
    await col.expenses.updateMany(LEGACY, { $set: { groupId, userId: owner._id }, $unset: { user: '' } });
  }

  // ---------- 3. budgets ----------
  const legacyBudgets = await col.budgets.find(LEGACY).toArray();
  for (const b of legacyBudgets) {
    const clash = await col.budgets.findOne({ groupId, categoryId: b.categoryId ?? null });
    const label = b.categoryId ? `category ${b.categoryId}` : 'overall';
    if (clash) {
      console.log(`  budget ${label}: group already has one (₹${clash.amount}) → keep it, drop v1 ₹${b.amount}`);
      if (apply) await col.budgets.deleteOne({ _id: b._id });
    } else if (apply) {
      await col.budgets.updateOne({ _id: b._id }, { $set: { groupId } });
    }
  }
  console.log(`  ${legacyBudgets.length} v1 budgets processed`);

  // ---------- verify ----------
  if (!apply) {
    console.log('\nDry run finished — nothing was changed. Re-run with --apply to migrate.');
    return;
  }
  const left = {
    categories: await col.categories.countDocuments(LEGACY),
    expenses: await col.expenses.countDocuments(LEGACY),
    budgets: await col.budgets.countDocuments(LEGACY),
  };
  const groupTotalAfter = await sum({ groupId, deletedAt: null });
  const expected = Math.round((groupTotalBefore + legacyTotal) * 100) / 100;
  const actual = Math.round(groupTotalAfter * 100) / 100;
  console.log(`\nLeft without groupId: ${JSON.stringify(left)}`);
  console.log(`Group total (active expenses): ₹${actual} (expected ₹${expected})`);
  if (left.categories || left.expenses || left.budgets || actual !== expected) {
    throw new Error('Verification failed — check the output above (the script is safe to re-run)');
  }
  console.log('✔ Migration complete.');
}

main()
  .catch((err: unknown) => {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
