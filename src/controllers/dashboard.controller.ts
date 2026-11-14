import type { Request, Response } from 'express';
import { groupIdOf } from '../middleware/auth';
import { Category } from '../models/category.model';
import { EXPENSE_POPULATE, Expense } from '../models/expense.model';
import { getBudgetStatuses } from '../services/budget-status';
import { getComingUp } from '../services/coming-up';
import { salarySection } from '../services/plan';
import { addMonths, currentMonth, daysInMonth, monthRange, todayIso } from '../services/date-utils';
import type { DashboardQuery } from '../validators/dashboard.schema';

const round2 = (n: number) => Math.round(n * 100) / 100;

interface FacetResult {
  byMonth: { _id: string; amount: number; count: number }[];
  byCategory: { amount: number; category: Record<string, unknown> | null }[];
}

/**
 * GET /api/dashboard?month=YYYY-MM — everything the dashboard page needs in one call (R7, R8 AC4, R15 AC6).
 *
 * One aggregation over the 6-month window uses `$facet` to run two sub-pipelines on the same
 * matched documents: totals per month (bar chart + this month + previous month) and
 * totals per category for the selected month (doughnut + top category).
 */
export async function getDashboard(req: Request, res: Response): Promise<void> {
  const { month = currentMonth() } = req.query as DashboardQuery;
  const groupId = groupIdOf(req); // every query below is scoped to the caller's group (design §8.2)
  const firstMonth = addMonths(month, -5);
  const { start: windowStart } = monthRange(firstMonth);
  const { start: monthStart, end: monthEnd } = monthRange(month);

  const [[facets], recent, budgets, comingUp, salaries] = await Promise.all([
    Expense.aggregate<FacetResult>([
      { $match: { groupId, deletedAt: null, date: { $gte: windowStart, $lt: monthEnd } } },
      {
        $facet: {
          byMonth: [
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m', date: '$date' } }, // dates are UTC midnight
                amount: { $sum: '$amount' },
                count: { $sum: 1 },
              },
            },
          ],
          byCategory: [
            { $match: { date: { $gte: monthStart } } },
            { $group: { _id: '$categoryId', amount: { $sum: '$amount' } } },
            { $sort: { amount: -1 } },
            { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'category' } },
            { $project: { _id: 0, amount: 1, category: { $first: '$category' } } },
          ],
        },
      },
    ]),
    // 5 most recent expenses of the selected month (R7 AC4).
    Expense.find({ groupId, deletedAt: null, date: { $gte: monthStart, $lt: monthEnd } })
      .sort({ date: -1, _id: -1 })
      .limit(5)
      .populate(EXPENSE_POPULATE),
    getBudgetStatuses(groupId, month),
    getComingUp(groupId), // R14 AC6: ignores `month`
    // R17 AC4 salary banner only. The Monthly plan card is gone (R19 AC7), so no monthPlan/getSavings here:
    // getSavings walks every plan month, which the dashboard no longer needs.
    salarySection(groupId, month),
  ]);

  const monthTotals = new Map(facets.byMonth.map((m) => [m._id, m]));
  const totalSpent = round2(monthTotals.get(month)?.amount ?? 0);
  const count = monthTotals.get(month)?.count ?? 0;

  // The previous month is always inside the 6-month window, so no extra query is needed.
  const prevTotal = monthTotals.get(addMonths(month, -1))?.amount ?? 0;
  const changeVsPrevPct = prevTotal > 0 ? Math.round(((totalSpent - prevTotal) / prevTotal) * 1000) / 10 : null;

  // Average per day: days elapsed so far for the current month, full month otherwise.
  const today = todayIso();
  const days = month === today.slice(0, 7) ? Number(today.slice(8, 10)) : daysInMonth(month);
  const avgPerDay = round2(totalSpent / days);

  // `$lookup` returns raw documents (_id, __v…). hydrate() + toJSON() gives the exact same
  // category shape (id, name, icon, color…) as every other endpoint.
  const byCategory = facets.byCategory.map((row) => ({
    category: row.category ? Category.hydrate(row.category).toJSON() : null,
    amount: round2(row.amount),
  }));

  // Oldest → newest, zero-filled so the bar chart always has 6 bars (R7 AC3).
  const last6Months = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(firstMonth, i);
    return { month: m, amount: round2(monthTotals.get(m)?.amount ?? 0) };
  });

  const overBudget = [budgets.overall, ...budgets.items].filter((b) => b?.status === 'danger');
  // R15 AC6: members whose balance is below zero join the over-budget warning.
  const overMembers = budgets.members.filter((m) => m.balance !== null && m.balance < 0);

  res.json({
    month,
    totalSpent,
    count,
    avgPerDay,
    topCategory: byCategory[0] ?? null,
    changeVsPrevPct,
    byCategory,
    last6Months,
    recent,
    overBudget,
    overMembers,
    members: budgets.members, // "My balance" card (R15 AC6)
    comingUp, // "Coming up" card (R14 AC6)
    plan: { month, started: salaries.started, missing: salaries.missing }, // R17 AC4 banner
  });
}
