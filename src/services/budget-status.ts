import type { Types } from 'mongoose';
import { Budget } from '../models/budget.model';
import { Expense } from '../models/expense.model';
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

const round2 = (n: number) => Math.round(n * 100) / 100;

/** R8 AC3: ok < 80%, warning 80–100% (inclusive), danger > 100%. */
export function budgetLevel(spent: number, budget: number): BudgetLevel {
  const ratio = spent / budget;
  if (ratio > 1) return 'danger';
  if (ratio >= 0.8) return 'warning';
  return 'ok';
}

/**
 * All of a group's budgets with what was spent against them in `month` (R8 AC2, AC5).
 * One aggregation gets spending for every category; the overall total is their sum.
 */
export async function getBudgetStatuses(
  groupId: Types.ObjectId,
  month: string,
): Promise<{ overall: BudgetStatus | null; items: BudgetStatus[] }> {
  const { start, end } = monthRange(month);

  const [budgets, spentRows] = await Promise.all([
    Budget.find({ groupId }).populate('category'),
    Expense.aggregate<{ _id: Types.ObjectId; spent: number }>([
      { $match: { groupId, deletedAt: null, date: { $gte: start, $lt: end } } },
      { $group: { _id: '$categoryId', spent: { $sum: '$amount' } } },
    ]),
  ]);

  const spentByCategory = new Map(spentRows.map((r) => [r._id.toString(), r.spent]));
  const totalSpent = spentRows.reduce((sum, r) => sum + r.spent, 0);

  const toStatus = (budget: (typeof budgets)[number], spentRaw: number): BudgetStatus => {
    const spent = round2(spentRaw);
    const json = budget.toJSON() as { category?: unknown };
    return {
      id: budget.id,
      category: json.category ?? null,
      budget: budget.amount,
      spent,
      percent: Math.round((spent / budget.amount) * 1000) / 10, // one decimal, e.g. 92.5
      status: budgetLevel(spent, budget.amount),
    };
  };

  let overall: BudgetStatus | null = null;
  const items: BudgetStatus[] = [];
  for (const b of budgets) {
    if (b.categoryId === null) {
      overall = toStatus(b, totalSpent);
    } else if (b.get('category')) {
      // (skips a budget whose category no longer exists)
      items.push(toStatus(b, spentByCategory.get(b.categoryId.toString()) ?? 0));
    }
  }

  // Highest usage first: the categories that need attention are at the top.
  items.sort((a, b) => b.percent - a.percent);
  return { overall, items };
}
