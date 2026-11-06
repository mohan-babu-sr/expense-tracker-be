import type { Request, Response } from 'express';
import { HttpError } from '../middleware/error-handler';
import { Category } from '../models/category.model';
import type { ICategory } from '../models/category.model';
import { DEFAULT_USER, Expense, PAYMENT_METHOD_LABELS } from '../models/expense.model';
import { toCsv } from '../services/csv';
import { parseIsoDate, toIsoDate, todayIso } from '../services/date-utils';
import { buildExpenseFilter, escapeRegex } from '../services/filter-builder';
import type { ExpenseBody, ExpenseFilter, ExpenseListQuery, MerchantQuery } from '../validators/expense.schema';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Validated body → document fields. Missing optional fields become `undefined` so PUT clears them. */
async function toExpenseFields(body: ExpenseBody) {
  if (!(await Category.exists({ _id: body.categoryId }))) {
    throw new HttpError(400, 'Validation failed', { categoryId: 'Category not found' });
  }
  return {
    amount: round2(body.amount),
    categoryId: body.categoryId,
    date: parseIsoDate(body.date),
    merchant: body.merchant,
    note: body.note,
    paymentMethod: body.paymentMethod,
    user: body.user,
  };
}

/** Active (not soft-deleted) expense or 404. */
async function findActiveOr404(id: string) {
  const expense = await Expense.findOne({ _id: id, deletedAt: null });
  if (!expense) throw new HttpError(404, 'Expense not found');
  return expense;
}

/** GET /api/expenses — filters + pagination, newest first, category populated (R2, R6, NFR1). */
export async function listExpenses(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ExpenseListQuery;
  const { filter } = buildExpenseFilter(query);
  const { page, pageSize } = query;

  // Page of items and the totals for ALL matching expenses, in parallel.
  const [items, [totals]] = await Promise.all([
    Expense.find(filter)
      .sort({ date: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate('category'),
    Expense.aggregate<{ total: number; count: number }>([
      { $match: filter },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  res.json({
    items,
    total: totals?.count ?? 0,
    page,
    pageSize,
    totalAmount: round2(totals?.total ?? 0),
  });
}

/**
 * GET /api/expenses/merchants?q=sw → ["Swiggy"] (R1 AC1a).
 * Distinct, case-insensitive prefix match, max 10, most-used first.
 * "Swiggy" and "swiggy" count as one merchant; the most recently used spelling is returned.
 */
export async function listMerchants(req: Request, res: Response): Promise<void> {
  const { q } = req.query as MerchantQuery;
  const merchantMatch = q ? new RegExp(`^${escapeRegex(q)}`, 'i') : { $nin: [null, ''] };

  const rows = await Expense.aggregate<{ name: string }>([
    { $match: { deletedAt: null, merchant: merchantMatch } },
    { $sort: { date: -1, _id: -1 } }, // so $first below = latest spelling
    { $group: { _id: { $toLower: '$merchant' }, name: { $first: '$merchant' }, uses: { $sum: 1 } } },
    { $sort: { uses: -1, _id: 1 } },
    { $limit: 10 },
    { $project: { _id: 0, name: 1 } },
  ]);
  res.json(rows.map((r) => r.name));
}

/**
 * GET /api/expenses/export — currently filtered expenses as CSV (R9).
 * Same filters as the list (no pagination), same order (newest first).
 */
export async function exportExpenses(req: Request, res: Response): Promise<void> {
  const { filter, from, to } = buildExpenseFilter(req.query as unknown as ExpenseFilter);

  // lean(): plain objects, no Mongoose document overhead — faster for thousands of rows.
  const expenses = await Expense.find(filter)
    .sort({ date: -1, _id: -1 })
    .populate<{ category: ICategory | null }>('category', 'name')
    .lean();

  const ddmmyyyy = (d: Date) => toIsoDate(d).split('-').reverse().join('-'); // 2026-11-06 → 06-11-2026
  const csv = toCsv(
    ['Date', 'User', 'Category', 'Amount', 'Merchant', 'Payment Method', 'Note'],
    expenses.map((e) => [
      ddmmyyyy(e.date),
      e.user ?? DEFAULT_USER, // lean() skips schema defaults → legacy rows need the fallback here

      e.category?.name ?? '',
      e.amount.toFixed(2),
      e.merchant,
      e.paymentMethod ? PAYMENT_METHOD_LABELS[e.paymentMethod] : '',
      e.note,
    ]),
  );

  // Open-ended ranges: no "from" → "start"; no "to" → today.
  const fileName = `expenses_${from ?? 'start'}_${to ?? todayIso()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(csv);
}

/** GET /api/expenses/:id (R3). */
export async function getExpense(req: Request, res: Response): Promise<void> {
  const expense = await findActiveOr404(req.params.id as string);
  await expense.populate('category');
  res.json(expense);
}

/** POST /api/expenses → 201 (R1). */
export async function createExpense(req: Request, res: Response): Promise<void> {
  const expense = await Expense.create(await toExpenseFields(req.body as ExpenseBody));
  await expense.populate('category');
  res.status(201).json(expense);
}

/** PUT /api/expenses/:id — full replace, same body as POST (R3). */
export async function updateExpense(req: Request, res: Response): Promise<void> {
  const expense = await findActiveOr404(req.params.id as string);
  expense.set(await toExpenseFields(req.body as ExpenseBody));
  await expense.save();
  await expense.populate('category');
  res.json(expense);
}

/** DELETE /api/expenses/:id → 204. Soft delete: sets deletedAt so Undo can restore (R4). */
export async function deleteExpense(req: Request, res: Response): Promise<void> {
  const expense = await findActiveOr404(req.params.id as string);
  expense.deletedAt = new Date();
  await expense.save();
  res.status(204).end();
}

/** POST /api/expenses/:id/restore — Undo (R4 AC2). Restoring an active expense is a no-op. */
export async function restoreExpense(req: Request, res: Response): Promise<void> {
  const expense = await Expense.findById(req.params.id as string);
  if (!expense) throw new HttpError(404, 'Expense not found');

  expense.deletedAt = null;
  // Its category may have been deleted while the expense was soft-deleted
  // (category delete only counts active expenses) → fall back to "Other".
  if (!(await Category.exists({ _id: expense.categoryId }))) {
    const other = await Category.findOne({ isSystem: true });
    if (other) expense.categoryId = other._id;
  }
  await expense.save();
  await expense.populate('category');
  res.json(expense);
}
