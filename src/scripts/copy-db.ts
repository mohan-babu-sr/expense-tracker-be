/**
 * Copies every collection (documents + indexes) from one database to another on the same Atlas cluster.
 * Free alternative to mongodump/mongorestore (design §8.1, tasks T23 / T31).
 *
 *   npm run db:copy -- --from expense_tracker --to expense_tracker_dev
 *   npm run db:copy -- --from expense_tracker --to expense_tracker_backup_20261110
 *
 * Safety: the target must end in `_dev` (dropped and replaced) or `_backup_YYYYMMDD` (must not exist yet),
 * so the live database can never be overwritten by this script. The source is only read.
 */
import mongoose from 'mongoose';
import type { Db, IndexDescription } from 'mongodb';
import { DB_NAME_PATTERN, env } from '../config/env';

const BATCH_SIZE = 1000;
const DEV_TARGET = /_dev$/;
const BACKUP_TARGET = /_backup_\d{8}$/;

function readArg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing --${name} <database>`);
  if (!DB_NAME_PATTERN.test(value)) throw new Error(`Invalid database name for --${name}: "${value}"`);
  return value;
}

async function collectionNames(db: Db): Promise<string[]> {
  const infos = await db.listCollections({ type: 'collection' }, { nameOnly: true }).toArray();
  return infos.map((c) => c.name).filter((n) => !n.startsWith('system.'));
}

async function copyCollection(source: Db, target: Db, name: string): Promise<{ copied: number; expected: number }> {
  const from = source.collection(name);
  const to = target.collection(name);
  const expected = await from.countDocuments();

  // Indexes first (except the automatic _id index), so unique constraints apply while inserting.
  for (const index of await from.indexes()) {
    if (index.name === '_id_') continue;
    const { key, v: _version, ns: _ns, ...options } = index as IndexDescription & { v?: number; ns?: string };
    await to.createIndex(key, options);
  }

  let batch: Record<string, unknown>[] = [];
  let copied = 0;
  for await (const doc of from.find()) {
    batch.push(doc);
    if (batch.length === BATCH_SIZE) {
      await to.insertMany(batch);
      copied += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    await to.insertMany(batch);
    copied += batch.length;
  }
  if (copied === 0) await target.createCollection(name).catch(() => undefined); // keep empty collections too
  return { copied, expected };
}

async function main(): Promise<void> {
  const fromName = readArg('from');
  const toName = readArg('to');

  if (fromName === toName) throw new Error('--from and --to must be different databases');
  const isDev = DEV_TARGET.test(toName);
  const isBackup = BACKUP_TARGET.test(toName);
  if (!isDev && !isBackup) {
    throw new Error(`Refusing target "${toName}": it must end in _dev or _backup_YYYYMMDD (protects the live DB)`);
  }

  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  const client = mongoose.connection.getClient();
  const source = client.db(fromName);
  const target = client.db(toName);

  const names = await collectionNames(source);
  if (names.length === 0) throw new Error(`Source database "${fromName}" has no collections — wrong name?`);

  const existing = await collectionNames(target);
  if (existing.length > 0) {
    if (isBackup) throw new Error(`Backup "${toName}" already exists — pick another date suffix`);
    console.log(`Dropping existing dev database "${toName}" (${existing.length} collections)…`);
    await target.dropDatabase();
  }

  console.log(`Copying "${fromName}" → "${toName}"`);
  let ok = true;
  for (const name of names) {
    const { copied, expected } = await copyCollection(source, target, name);
    const match = copied === expected;
    ok &&= match;
    console.log(`  ${match ? '✔' : '✖'} ${name}: ${copied}/${expected} documents`);
  }
  if (!ok) throw new Error('Some collections did not copy completely (were documents added during the copy?)');
  console.log('Done.');
}

main()
  .catch((err: unknown) => {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
