import type { Types } from 'mongoose';
import { HttpError } from '../middleware/error-handler';
import { Expense } from '../models/expense.model';
import { Group } from '../models/group.model';
import { RegularEntry } from '../models/regular-entry.model';
import { RegularItem, type IRegularItem } from '../models/regular-item.model';
import { Salary } from '../models/salary.model';
import { User } from '../models/user.model';
import { currentMonth, monthRange, toIsoDate } from './date-utils';

/*
 * Monthly plan rules — design §12.3 (R17–R19).
 * Nothing calculated is stored: every number below is recomputed from salaries, regular entries, limits and
 * expenses on each request, so an edit to a past month can never leave a stale total behind.
 */

export const round2 = (n: number) => Math.round(n * 100) / 100;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** '2026-11' → 'November 2026' (user-facing messages). */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Whole months from `a` to `b`: monthsBetween('2026-11', '2027-02') → 3 (negative when b is earlier). */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

type DueFields = Pick<IRegularItem, 'startMonth' | 'endMonth' | 'every'>;

/** R18 AC2: due in `m` when inside start..end and a whole number of repeats after the start. */
export function isDue(item: DueFields, m: string): boolean {
  if (m < item.startMonth || (item.endMonth && m > item.endMonth)) return false;
  return monthsBetween(item.startMonth, m) % item.every === 0;
}

/** First month ≥ `from` the item is due, or null if it has ended — for the Regular items list ("Next: Feb 2027"). */
export function nextDueMonth(item: DueFields, from: string): string | null {
  if (item.endMonth && from > item.endMonth) return null;
  const start = from < item.startMonth ? item.startMonth : from;
  const offset = monthsBetween(item.startMonth, start) % item.every;
  const months = offset === 0 ? 0 : item.every - offset;
  const [y, m] = start.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  const next = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return item.endMonth && next > item.endMonth ? null : next;
}

/** The group's plan start month, or null when the plan hasn't started (not migrated yet). */
export async function planStartOf(groupId: Types.ObjectId): Promise<string | null> {
  const group = await Group.findById(groupId, { planStartMonth: 1 }).lean();
  return group?.planStartMonth ?? null;
}

/** `YYYY-MM` strings compare correctly as plain strings ('2026-09' < '2026-11'). */
export const isPlanMonth = (start: string | null, month: string): boolean => start !== null && month >= start;

// ---------------------------------------------------------------------------------------------------------------
// Salaries (R17)

type NamedUser = { id: string; name: string };

export interface SalaryRow {
  user: NamedUser;
  /** null = not entered yet. */
  amount: number | null;
  updatedBy: NamedUser | null;
  updatedAt: string | null;
  /** true = has a salary this month but is no longer an active member (read-only, still counted). */
  former: boolean;
}

export interface SalarySection {
  month: string;
  /** false for months before the plan start (or plan not started) — nothing required, nothing counted. */
  started: boolean;
  planStartMonth: string | null;
  /** Active members (sorted by name) + anyone else who has a salary saved for this month. */
  salaries: SalaryRow[];
  /** Active members without a salary for this month (R17 AC4 banner, R19 AC1 "Waiting for salary"). */
  missing: NamedUser[];
  /** Every saved salary of the month — money that came in counts even if that person later left. */
  salaryTotal: number;
}

/** Salaries of a month — the salary part of `PlanMonth` (design §12.4). */
export async function salarySection(
  groupId: Types.ObjectId,
  month: string,
  planStartMonth?: string | null,
): Promise<SalarySection> {
  const [start, members, salaries] = await Promise.all([
    planStartMonth === undefined ? planStartOf(groupId) : planStartMonth,
    User.find({ groupId, status: 'active' }, { name: 1 }).sort({ name: 1 }).lean(),
    Salary.find({ groupId, month }).lean(),
  ]);

  // Names for editors and former members, who may no longer be in this group.
  const memberIds = new Set(members.map((m) => m._id.toString()));
  const otherIds = new Set<string>();
  for (const s of salaries) {
    otherIds.add(s.updatedBy.toString());
    if (!memberIds.has(s.userId.toString())) otherIds.add(s.userId.toString());
  }
  const others = await User.find({ _id: { $in: [...otherIds] } }, { name: 1 }).lean();
  const nameOf = new Map([...members, ...others].map((u) => [u._id.toString(), u.name]));
  const named = (id: string): NamedUser => ({ id, name: nameOf.get(id) ?? 'Former member' });
  const byUser = new Map(salaries.map((s) => [s.userId.toString(), s]));

  const toRow = (id: string, former: boolean): SalaryRow => {
    const s = byUser.get(id);
    return {
      user: named(id),
      amount: s ? s.amount : null,
      updatedBy: s ? named(s.updatedBy.toString()) : null,
      updatedAt: s ? ((s as { updatedAt?: Date }).updatedAt?.toISOString() ?? null) : null,
      former,
    };
  };
  const rows = members.map((m) => toRow(m._id.toString(), false));
  for (const s of salaries) {
    const id = s.userId.toString();
    if (!memberIds.has(id)) rows.push(toRow(id, true));
  }

  return {
    month,
    started: isPlanMonth(start, month),
    planStartMonth: start,
    salaries: rows,
    missing: rows.filter((r) => !r.former && r.amount === null).map((r) => r.user),
    salaryTotal: round2(salaries.reduce((sum, s) => sum + s.amount, 0)),
  };
}

/**
 * Salary gate (R17 AC3, design §12.3): an expense for `userId` dated `date` needs that member's salary for that
 * month — only for plan months. 409 `SALARY_REQUIRED` tells the client which member + month to ask for.
 */
export async function assertSalaryEntered(groupId: Types.ObjectId, userId: string, date: Date): Promise<void> {
  const month = toIsoDate(date).slice(0, 7);
  if (!isPlanMonth(await planStartOf(groupId), month)) return;
  if (await Salary.exists({ groupId, month, userId })) return;

  const user = await User.findById(userId, { name: 1 }).lean();
  const name = user?.name ?? 'This member';
  throw new HttpError(409, `Enter ${name}'s salary for ${monthLabel(month)} first`, undefined, {
    code: 'SALARY_REQUIRED',
    month,
    userId,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Regular entries (R18)

export interface RegularEntryView {
  /** null for a preview of a future month (not saved yet). */
  id: string | null;
  itemId: string;
  month: string;
  name: string;
  amount: number;
  every: number;
  paidAt: string | null;
  paidBy: NamedUser | null;
}

/**
 * Creates the missing entries of `month` from the templates (design §12.3) — only for plan months up to the
 * current month (future months are previews). Upserts with $setOnInsert: existing entries are never changed,
 * and the unique { groupId, itemId, month } index makes two parallel calls safe.
 */
export async function ensureEntries(groupId: Types.ObjectId, month: string, start: string | null): Promise<void> {
  if (!isPlanMonth(start, month) || month > currentMonth()) return;
  const items = await RegularItem.find({ groupId, deletedAt: null }).lean();
  const due = items.filter((i) => isDue(i, month));
  if (!due.length) return;
  try {
    await RegularEntry.bulkWrite(
      due.map((i) => ({
        updateOne: {
          filter: { groupId, itemId: i._id, month },
          update: { $setOnInsert: { name: i.name, amount: i.amount, paidAt: null, paidBy: null } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  } catch (err) {
    // A parallel request inserted the same entry first → duplicate key; the entry exists, which is all we need.
    if ((err as { code?: unknown }).code !== 11000 && !String(err).includes('E11000')) throw err;
  }
}

/** The regular entries of a month (sorted by name): saved entries, or template previews for future months. */
export async function regularSection(
  groupId: Types.ObjectId,
  month: string,
  start: string | null,
): Promise<RegularEntryView[]> {
  if (!isPlanMonth(start, month)) return [];
  const items = await RegularItem.find({ groupId }).lean(); // incl. deleted: past entries may point to them
  const everyOf = new Map(items.map((i) => [i._id.toString(), i.every]));

  if (month > currentMonth()) {
    return items
      .filter((i) => i.deletedAt === null && isDue(i, month))
      .map((i) => ({
        id: null,
        itemId: i._id.toString(),
        month,
        name: i.name,
        amount: i.amount,
        every: i.every,
        paidAt: null,
        paidBy: null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  await ensureEntries(groupId, month, start);
  const entries = await RegularEntry.find({ groupId, month }).sort({ name: 1 }).lean();
  const payerIds = entries.flatMap((e) => (e.paidBy ? [e.paidBy] : []));
  const payers = await User.find({ _id: { $in: payerIds } }, { name: 1 }).lean();
  const payerName = new Map(payers.map((u) => [u._id.toString(), u.name]));

  return entries.map((e) => toEntryView(e, everyOf.get(e.itemId.toString()) ?? 1, payerName));
}

export function toEntryView(
  e: { _id: Types.ObjectId; itemId: Types.ObjectId; month: string; name: string; amount: number; paidAt: Date | null; paidBy: Types.ObjectId | null },
  every: number,
  payerName: Map<string, string>,
): RegularEntryView {
  const by = e.paidBy?.toString();
  return {
    id: e._id.toString(),
    itemId: e.itemId.toString(),
    month: e.month,
    name: e.name,
    amount: e.amount,
    every,
    paidAt: e.paidAt ? e.paidAt.toISOString() : null,
    paidBy: by ? { id: by, name: payerName.get(by) ?? 'Former member' } : null,
  };
}

/**
 * Template edited or deleted (R18 AC5): only the CURRENT month's unpaid entry follows it — updated when the item
 * is still due, removed when it isn't (or the item was deleted). Past and paid entries are never touched; future
 * months follow the template automatically (they are previews).
 */
export async function syncCurrentEntry(item: { _id: Types.ObjectId; groupId: Types.ObjectId } & DueFields & {
  name: string;
  amount: number;
  deletedAt: Date | null;
}): Promise<void> {
  const month = currentMonth();
  const filter = { groupId: item.groupId, itemId: item._id, month, paidAt: null };
  if (item.deletedAt || !isDue(item, month)) {
    await RegularEntry.deleteOne(filter);
  } else {
    await RegularEntry.updateOne(filter, { $set: { name: item.name, amount: item.amount } });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Month plan (R19 AC1–AC3)

export interface PlanMonth extends SalarySection {
  /** true when the month is over (it then counts in the overall savings, R19 AC4). */
  finished: boolean;
  regular: RegularEntryView[];
  regularTotal: number;
  /** Σ active members' monthly limits (R15; no limit = 0). Current limits — R15 keeps no history. */
  limitsTotal: number;
  /** Salary total − (regular + limits) — R19 AC1. */
  planned: number;
  /** All the group's expenses in the month. */
  spent: number;
  /** Salary total − regular − spent — R19 AC2 (so far, for the current month). */
  actual: number;
}

/** Σ of all the group's (not deleted) expenses per month, for a list of months — one aggregation. */
export async function spentByMonth(groupId: Types.ObjectId, from: string, to: string): Promise<Map<string, number>> {
  const rows = await Expense.aggregate<{ _id: string; spent: number }>([
    {
      $match: {
        groupId,
        deletedAt: null,
        date: { $gte: monthRange(from).start, $lt: monthRange(to).end },
      },
    },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date' } }, spent: { $sum: '$amount' } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.spent]));
}

export async function limitsTotalOf(groupId: Types.ObjectId): Promise<number> {
  const users = await User.find({ groupId, status: 'active' }, { monthlyLimit: 1 }).lean();
  return round2(users.reduce((sum, u) => sum + (u.monthlyLimit ?? 0), 0));
}

/** Everything the Plan page's Month tab needs for one month (`PlanMonth`, design §12.4). */
export async function monthPlan(groupId: Types.ObjectId, month: string): Promise<PlanMonth> {
  const start = await planStartOf(groupId);
  const [salaries, regular, limitsTotal, spentMap] = await Promise.all([
    salarySection(groupId, month, start),
    regularSection(groupId, month, start),
    limitsTotalOf(groupId),
    spentByMonth(groupId, month, month),
  ]);
  const regularTotal = round2(regular.reduce((sum, e) => sum + e.amount, 0));
  const spent = round2(spentMap.get(month) ?? 0);
  return {
    ...salaries,
    finished: month < currentMonth(),
    regular,
    regularTotal,
    limitsTotal,
    planned: round2(salaries.salaryTotal - (regularTotal + limitsTotal)),
    spent,
    actual: round2(salaries.salaryTotal - regularTotal - spent),
  };
}
