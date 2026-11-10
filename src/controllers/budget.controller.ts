import type { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { groupIdOf } from '../middleware/auth';
import { HttpError } from '../middleware/error-handler';
import { Budget } from '../models/budget.model';
import { Category } from '../models/category.model';
import { User } from '../models/user.model';
import { getBudgetStatuses, memberSpent, toMemberBudget } from '../services/budget-status';
import { currentMonth } from '../services/date-utils';
import type { BudgetBody, BudgetQuery, MemberLimitBody } from '../validators/budget.schema';

/* Every query is scoped to the caller's group (design §8.2). Writes are owner-only (requireOwner, R15 AC5). */

/** GET /api/budgets?month= → { overall, members, items } with spent / percent / status (R8, R15 AC2–AC4). */
export async function listBudgets(req: Request, res: Response): Promise<void> {
  const { month } = req.query as BudgetQuery;
  res.json(await getBudgetStatuses(groupIdOf(req), month ?? currentMonth()));
}

/** PUT /api/budgets — create or update the budget for a category (R8 AC1). */
export async function upsertBudget(req: Request, res: Response): Promise<void> {
  const groupId = groupIdOf(req);
  const { categoryId, amount } = req.body as BudgetBody;

  if (!(await Category.exists({ _id: categoryId, groupId }))) {
    throw new HttpError(400, 'Validation failed', { categoryId: 'Category not found' });
  }

  // Upsert = "update if it exists, otherwise insert" in one atomic call; the unique index on
  // { groupId, categoryId } guarantees one budget per category per group. On insert, the filter's
  // fields (groupId, categoryId) become fields of the new document.
  const budget = await Budget.findOneAndUpdate(
    { groupId, categoryId },
    { amount: Math.round(amount * 100) / 100 },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).populate('category');

  res.json(budget);
}

/** DELETE /api/budgets/:id → 204. */
export async function deleteBudget(req: Request, res: Response): Promise<void> {
  const result = await Budget.deleteOne({ _id: req.params.id as string, groupId: groupIdOf(req) });
  if (result.deletedCount === 0) throw new HttpError(404, 'Budget not found');
  res.status(204).end();
}

/**
 * PUT /api/budgets/members/:userId?month= — set or clear (null) a member's monthly limit (R15 AC1).
 * Only active members of the caller's group; anyone else (other group, pending, bad id) → 404.
 * Returns the member's row for `month` so the page can update it without reloading.
 */
export async function setMemberLimit(req: Request, res: Response): Promise<void> {
  const groupId = groupIdOf(req);
  const userId = req.params.userId as string;
  const { month } = req.query as BudgetQuery;
  const { limit } = req.body as MemberLimitBody;

  const user = isValidObjectId(userId) ? await User.findOne({ _id: userId, groupId, status: 'active' }) : null;
  if (!user) throw new HttpError(404, 'Member not found');

  user.monthlyLimit = limit === null ? null : Math.round(limit * 100) / 100;
  await user.save();
  res.json(toMemberBudget(user, await memberSpent(groupId, user._id, month ?? currentMonth())));
}
