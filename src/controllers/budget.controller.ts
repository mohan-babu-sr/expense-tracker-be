import type { Request, Response } from 'express';
import { HttpError } from '../middleware/error-handler';
import { Budget } from '../models/budget.model';
import { Category } from '../models/category.model';
import { getBudgetStatuses } from '../services/budget-status';
import { currentMonth } from '../services/date-utils';
import type { BudgetBody, BudgetQuery } from '../validators/budget.schema';

/** GET /api/budgets?month= → { overall, items } with spent / percent / status (R8 AC2, AC3, AC5). */
export async function listBudgets(req: Request, res: Response): Promise<void> {
  const { month } = req.query as BudgetQuery;
  res.json(await getBudgetStatuses(month ?? currentMonth()));
}

/** PUT /api/budgets — create or update the budget for a category (or overall when categoryId is null). */
export async function upsertBudget(req: Request, res: Response): Promise<void> {
  const { categoryId, amount } = req.body as BudgetBody;

  if (categoryId && !(await Category.exists({ _id: categoryId }))) {
    throw new HttpError(400, 'Validation failed', { categoryId: 'Category not found' });
  }

  // Upsert = "update if it exists, otherwise insert" in one atomic call; the unique index
  // on categoryId guarantees there is never more than one budget per category.
  const budget = await Budget.findOneAndUpdate(
    { categoryId },
    { amount: Math.round(amount * 100) / 100 },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).populate('category');

  res.json(budget);
}

/** DELETE /api/budgets/:id → 204. */
export async function deleteBudget(req: Request, res: Response): Promise<void> {
  const result = await Budget.deleteOne({ _id: req.params.id as string });
  if (result.deletedCount === 0) throw new HttpError(404, 'Budget not found');
  res.status(204).end();
}
