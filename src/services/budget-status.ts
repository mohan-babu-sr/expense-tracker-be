import type { Types } from 'mongoose';
import { Budget } from '../models/budget.model';
import { Expense } from '../models/expense.model';
import { User, type UserDoc, type UserRole } from '../models/user.model';
import { monthRange } from './date-utils';

export type BudgetLevel = 'ok' | 'warning' | 'danger';

/** design §2 "BudgetStatus" — shared by GET /budgets and the dashboard's overBudget (T7). */
export interface BudgetStatus {
  id: string;
  category: unknown | null; // populated category JSON; null for the overall budget
  budget: number;
  spent: number;
  percent: number;
  status: BudgetLevel;
}

/** design §10.2 — one active member's limit and what they spent (R15 AC2). Nulls when no limit is set. */
export interface MemberBudget {
  user: { id: string; name: string; role: UserRole };
  limit: number | null;
  spent: number;
  balance: number | null;
  percent: number | null;
  status: BudgetLevel | null;
}

export interface BudgetStatuses {
  overall: BudgetStatus | null;
  members: MemberBudget[];
  items: BudgetStatus[];
}

/** id of the computed overall budget — it has no document any more (R15 AC3). */
export const OVERALL_ID = 'overall';

const round2 = (n: number) => Math.round(n * 100) / 100;
const percentOf = (spent: number, budget: number) => Math.round((spent / budget) * 1000) / 10; // e.g. 92.5

/** R8 AC3: ok < 80%, warning 80–100% (inclusive), danger > 100%. */
export function budgetLevel(spent: number, budget: number): BudgetLevel {
  const ratio = spent / budget;
  if (ratio > 1) return 'danger';
  if (ratio >= 0.8) return 'warning';
  return 'ok';
}

/** A member row from the user and their spending this month (shared with PUT /budgets/members/:userId). */
export function toMemberBudget(user: UserDoc, spentRaw: number): MemberBudget {
  const spent = round2(spentRaw);
  const limit = user.monthlyLimit ?? null;
  return {
    user: { id: user.id, name: user.name, role: user.role },
    limit,
    spent,
    balance: limit === null ? null : round2(limit - spent),
    percent: limit === null ? null : percentOf(spent, limit),
    status: limit === null ? null : budgetLevel(spent, limit),
  };
}

/** What one member spent in `month` (R15 AC2: expenses whose spender is that member). */
export async function memberSpent(groupId: Types.ObjectId, userId: Types.ObjectId, month: string): Promise<number> {
  const { start, end } = monthRange(month);
  const [row] = await Expense.aggregate<{ spent: number }>([
    { $match: { groupId, userId, deletedAt: null, date: { $gte: start, $lt: end } } },
    { $group: { _id: null, spent: { $sum: '$amount' } } },
  ]);
  return row?.spent ?? 0;
}

/**
 * All of a group's budgets with what was spent against them in `month` (R8 AC2, R15 AC2–AC4).
 * Two aggregations over the same month run in parallel: spending per category and spending per member.
 * The overall budget is computed: sum of the active members' limits vs. the group's total (R15 AC3).
 */
export async function getBudgetStatuses(groupId: Types.ObjectId, month: string): Promise<BudgetStatuses> {
  const { start, end } = monthRange(month);
  const inMonth = { $match: { groupId, deletedAt: null, date: { $gte: start, $lt: end } } };

  const [budgets, users, byCategory, byUser] = await Promise.all([
    // categoryId null = the retired stored overall budget (removed by migrate:v3) — ignored here.
    Budget.find({ groupId, categoryId: { $ne: null } }).populate('category'),
    User.find({ groupId, status: 'active' }).sort({ name: 1 }),
    Expense.aggregate<{ _id: Types.ObjectId; spent: number }>([
      inMonth,
      { $group: { _id: '$categoryId', spent: { $sum: '$amount' } } },
    ]),
    Expense.aggregate<{ _id: Types.ObjectId; spent: number }>([
      inMonth,
      { $group: { _id: '$userId', spent: { $sum: '$amount' } } },
    ]),
  ]);

  const spentByCategory = new Map(byCategory.map((r) => [r._id.toString(), r.spent]));
  const spentByUser = new Map(byUser.map((r) => [r._id.toString(), r.spent]));
  const totalSpent = round2(byCategory.reduce((sum, r) => sum + r.spent, 0));

  const items: BudgetStatus[] = [];
  for (const b of budgets) {
    if (!b.get('category') || !b.categoryId) continue; // skips a budget whose category no longer exists
    const spent = round2(spentByCategory.get(b.categoryId.toString()) ?? 0);
    items.push({
      id: b.id,
      category: (b.toJSON() as { category?: unknown }).category ?? null,
      budget: b.amount,
      spent,
      percent: percentOf(spent, b.amount),
      status: budgetLevel(spent, b.amount),
    });
  }
  // Highest usage first: the categories that need attention are at the top.
  items.sort((a, b) => b.percent - a.percent);

  const members = users.map((u) => toMemberBudget(u, spentByUser.get(u.id) ?? 0));

  // Overall spent = everything the group spent, including members without a limit (R15 AC3).
  const limits = members.flatMap((m) => (m.limit === null ? [] : [m.limit]));
  const overallBudget = round2(limits.reduce((sum, l) => sum + l, 0));
  const overall: BudgetStatus | null = limits.length
    ? {
        id: OVERALL_ID,
        category: null,
        budget: overallBudget,
        spent: totalSpent,
        percent: percentOf(totalSpent, overallBudget),
        status: budgetLevel(totalSpent, overallBudget),
      }
    : null;

  return { overall, members, items };
}
