import type { Request, Response } from 'express';
import type { Types } from 'mongoose';
import { HttpError } from '../middleware/error-handler';
import { Budget } from '../models/budget.model';
import { Category } from '../models/category.model';
import { Expense } from '../models/expense.model';
import type { CategoryBody } from '../validators/category.schema';

/**
 * Active-expense counts per category id (R5 AC3). One aggregation for all categories
 * instead of one count query per category. Pass `categoryId` to count just one.
 */
async function getExpenseCounts(categoryId?: Types.ObjectId): Promise<Map<string, number>> {
  const rows = await Expense.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { deletedAt: null, ...(categoryId && { categoryId }) } },
    { $group: { _id: '$categoryId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.count]));
}

async function ensureNameIsFree(name: string, exceptId?: string): Promise<void> {
  const existing = await Category.findOne({ nameLower: name.trim().toLowerCase() });
  if (existing && existing.id !== exceptId) {
    throw new HttpError(409, `A category named "${existing.name}" already exists`, {
      name: 'Name already exists',
    });
  }
}

async function findOr404(id: string) {
  const category = await Category.findById(id);
  if (!category) throw new HttpError(404, 'Category not found');
  return category;
}

/** GET /api/categories — sorted by name with "Other" last; each with expenseCount. */
export async function listCategories(_req: Request, res: Response): Promise<void> {
  const [categories, counts] = await Promise.all([
    Category.find().sort({ isSystem: 1, nameLower: 1 }),
    getExpenseCounts(),
  ]);
  res.json(categories.map((c) => ({ ...c.toJSON(), expenseCount: counts.get(c.id) ?? 0 })));
}

/** POST /api/categories — 201; 409 on duplicate name (R5 AC2). */
export async function createCategory(req: Request, res: Response): Promise<void> {
  const body = req.body as CategoryBody;
  await ensureNameIsFree(body.name);
  const category = await Category.create(body);
  res.status(201).json(category);
}

/** PUT /api/categories/:id — 409 on duplicate name (R5 AC2). */
export async function updateCategory(req: Request, res: Response): Promise<void> {
  const body = req.body as CategoryBody;
  const category = await findOr404(req.params.id as string); // `/:id` is always a single string
  await ensureNameIsFree(body.name, category.id);
  category.set(body);
  await category.save(); // save() (not findByIdAndUpdate) so nameLower is recalculated
  res.json(category);
}

/** DELETE /api/categories/:id — 204; 409 if system category or used by expenses (R5 AC3). */
export async function deleteCategory(req: Request, res: Response): Promise<void> {
  const category = await findOr404(req.params.id as string); // `/:id` is always a single string
  const expenseCount = (await getExpenseCounts(category._id)).get(category.id) ?? 0;

  if (category.isSystem) {
    throw new HttpError(409, `"${category.name}" is a system category and cannot be deleted`, undefined, {
      expenseCount,
    });
  }
  if (expenseCount > 0) {
    const plural = expenseCount === 1 ? 'expense' : 'expenses';
    throw new HttpError(
      409,
      `"${category.name}" is used by ${expenseCount} ${plural} and cannot be deleted`,
      undefined,
      { expenseCount },
    );
  }

  await category.deleteOne();
  await Budget.deleteOne({ categoryId: category._id }); // its budget is meaningless now
  res.status(204).end();
}
