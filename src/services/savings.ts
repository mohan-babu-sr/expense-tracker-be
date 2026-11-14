import type { Types } from 'mongoose';
import { ExtraIncome, type ExtraIncomeSource } from '../models/extra-income.model';
import { RegularEntry } from '../models/regular-entry.model';
import { Salary } from '../models/salary.model';
import { User } from '../models/user.model';
import { Withdrawal } from '../models/withdrawal.model';
import { addMonths, currentMonth, toIsoDate } from './date-utils';
import { ensureEntries, limitsTotalOf, monthsBetween, planStartOf, round2, spentByMonth } from './plan';

/*
 * Savings tracker — R19 AC3–AC6 + R20, design §12.3. Every month starts at ₹0; a month's actual savings join the
 * overall total once the month is over. Extra income (R20) joins at once. Computed on every request (nothing
 * stored → never stale).
 */

export interface SavingsMonth {
  month: string;
  salaryTotal: number;
  regularTotal: number;
  spent: number;
  actual: number;
  /** Extra income dated in this month (R20) — shown on the row, NOT part of `actual`. */
  extra: number;
  /** false = the current month ("so far"), not yet in the overall total. */
  finished: boolean;
}

export interface WithdrawalView {
  id: string;
  amount: number;
  date: string;
  reason: string;
  recordedBy: { id: string; name: string };
}

export interface ExtraIncomeView {
  id: string;
  amount: number;
  date: string;
  source: ExtraIncomeSource;
  note: string | null;
  recordedBy: { id: string; name: string };
}

export interface Savings {
  started: boolean;
  planStartMonth: string | null;
  /** Σ actual of finished months + Σ extra income − Σ withdrawals (R19 AC4, R20 AC2). Can be negative. */
  overall: number;
  savedTotal: number;
  extraTotal: number;
  withdrawnTotal: number;
  /** The current month so far (R19 AC4: shown separately). null before the plan starts. */
  thisMonth: { month: string; planned: number; actual: number } | null;
  /** Newest first (R19 AC6). */
  months: SavingsMonth[];
  extraIncome: ExtraIncomeView[];
  withdrawals: WithdrawalView[];
}

/** Everything the Savings tab needs, plus `overall` for the dashboard card and the withdrawal check. */
export async function getSavings(groupId: Types.ObjectId): Promise<Savings> {
  const start = await planStartOf(groupId);
  const now = currentMonth();
  const newestFirst = { date: -1, _id: -1 } as const;
  const [withdrawals, extras] = await Promise.all([
    Withdrawal.find({ groupId }).sort(newestFirst).lean(),
    ExtraIncome.find({ groupId }).sort(newestFirst).lean(),
  ]);
  const withdrawnTotal = round2(withdrawals.reduce((s, w) => s + w.amount, 0));
  const extraTotal = round2(extras.reduce((s, e) => s + e.amount, 0));

  const recorderIds = [...withdrawals, ...extras].map((r) => r.userId);
  const users = await User.find({ _id: { $in: recorderIds } }, { name: 1 }).lean();
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));
  const recordedBy = (id: Types.ObjectId) => ({ id: id.toString(), name: nameOf.get(id.toString()) ?? 'Former member' });
  const withdrawalViews: WithdrawalView[] = withdrawals.map((w) => ({
    id: w._id.toString(),
    amount: w.amount,
    date: toIsoDate(w.date),
    reason: w.reason,
    recordedBy: recordedBy(w.userId),
  }));
  const extraViews: ExtraIncomeView[] = extras.map((e) => ({
    id: e._id.toString(),
    amount: e.amount,
    date: toIsoDate(e.date),
    source: e.source,
    note: e.note ?? null,
    recordedBy: recordedBy(e.userId),
  }));
  // Extra income per month for the history rows ('YYYY-MM' = first 7 chars of the ISO date).
  const extraOf = new Map<string, number>();
  for (const e of extraViews) extraOf.set(e.date.slice(0, 7), (extraOf.get(e.date.slice(0, 7)) ?? 0) + e.amount);

  if (start === null || start > now) {
    return {
      started: false,
      planStartMonth: start,
      overall: round2(extraTotal - withdrawnTotal),
      savedTotal: 0,
      extraTotal,
      withdrawnTotal,
      thisMonth: null,
      months: [],
      extraIncome: extraViews,
      withdrawals: withdrawalViews,
    };
  }

  // All plan months start..now. ensureEntries first, so a month nobody opened still has its regular entries.
  const months = Array.from({ length: monthsBetween(start, now) + 1 }, (_, i) => addMonths(start, i));
  for (const m of months) await ensureEntries(groupId, m, start);

  const inRange = { groupId, month: { $gte: start, $lte: now } };
  const [salaryRows, regularRows, spentMap, limitsTotal] = await Promise.all([
    Salary.aggregate<{ _id: string; total: number }>([
      { $match: inRange },
      { $group: { _id: '$month', total: { $sum: '$amount' } } },
    ]),
    RegularEntry.aggregate<{ _id: string; total: number }>([
      { $match: inRange },
      { $group: { _id: '$month', total: { $sum: '$amount' } } },
    ]),
    spentByMonth(groupId, start, now),
    limitsTotalOf(groupId),
  ]);
  const salaryOf = new Map(salaryRows.map((r) => [r._id, r.total]));
  const regularOf = new Map(regularRows.map((r) => [r._id, r.total]));

  const rows: SavingsMonth[] = months.map((m) => {
    const salaryTotal = round2(salaryOf.get(m) ?? 0);
    const regularTotal = round2(regularOf.get(m) ?? 0);
    const spent = round2(spentMap.get(m) ?? 0);
    const actual = round2(salaryTotal - regularTotal - spent);
    return { month: m, salaryTotal, regularTotal, spent, actual, extra: round2(extraOf.get(m) ?? 0), finished: m < now };
  });

  const savedTotal = round2(rows.filter((r) => r.finished).reduce((s, r) => s + r.actual, 0));
  const current = rows[rows.length - 1];
  return {
    started: true,
    planStartMonth: start,
    overall: round2(savedTotal + extraTotal - withdrawnTotal),
    savedTotal,
    extraTotal,
    withdrawnTotal,
    thisMonth: {
      month: now,
      planned: round2(current.salaryTotal - (current.regularTotal + limitsTotal)),
      actual: current.actual,
    },
    months: rows.reverse(),
    extraIncome: extraViews,
    withdrawals: withdrawalViews,
  };
}
