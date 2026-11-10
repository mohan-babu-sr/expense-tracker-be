import type { Request, Response } from 'express';
import type { Types } from 'mongoose';
import { groupIdOf } from '../middleware/auth';
import { HttpError } from '../middleware/error-handler';
import { Category } from '../models/category.model';
import type { ICategory } from '../models/category.model';
import { EXPENSE_POPULATE, Expense, PAYMENT_METHOD_LABELS, type IExpense } from '../models/expense.model';
import { User } from '../models/user.model';
import { toCsv } from '../services/csv';
import { parseIsoDate, toIsoDate, todayIso } from '../services/date-utils';
import { buildExpenseFilter, escapeRegex } from '../services/filter-builder';
import type { ExpenseBody, ExpenseFilter, ExpenseListQuery, MerchantQuery } from '../validators/expense.schema';

/*
 * Every query in this file includes `groupId` (design §8.2 scoping rule): an id from another group behaves
 * exactly like an id that doesn't exist (404 / "not found"), so nothing about other groups leaks (R13 AC8).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Validated body → document fields. Missing optional fields become `undefined` so PUT clears them.
 * `existing` (PUT): keeps the current spender valid even if they've since left / been disabled.
 */
async function toExpenseFields(req: Request, body: ExpenseBody, existing?: IExpense) {
  const groupId = groupIdOf(req);

  if (!(await Category.exists({ _id: body.categoryId, groupId }))) {
    throw new HttpError(400, 'Validation failed', { categoryId: 'Category not found' });
  }

  // R13 AC9: default = the signed-in member; otherwise must be an active member of this group.
  const userId = body.userId ?? req.user!.id;
  const unchanged = existing && existing.userId.toString() === userId;
  if (!unchanged && !(await User.exists({ _id: userId, groupId, status: 'active' }))) {
    throw new HttpError(400, 'Validation failed', { userId: 'Not a member of this group' });
  }

  return {
    groupId,
    amount: round2(body.amount),
    categoryId: body.categoryId,
    date: parseIsoDate(body.date),
    merchant: body.merchant,
    note: body.note,
    paymentMethod: body.paymentMethod,
    userId,
  };
}

/** Active (not soft-deleted) expense of the caller's group, or 404. */
async function findActiveOr404(req: Request) {
  const expense = await Expense.findOne({ _id: req.params.id as string, groupId: groupIdOf(req), deletedAt: null });
  if (!expense) throw new HttpError(404, 'Expense not found');
  return expense;
}

/** GET /api/expenses — filters + pagination, newest first, category + user populated (R2, R6, NFR1). */
export async function listExpenses(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ExpenseListQuery;
  const { filter } = buildExpenseFilter(query, groupIdOf(req));
  const { page, pageSize } = query;

  // Page of items and the totals for ALL matching expenses, in parallel.
  const [items, [totals]] = await Promise.all([
    Expense.find(filter)
      .sort({ date: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate(EXPENSE_POPULATE),
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
 * GET /api/expenses/merchants?q=sw → ["Swiggy"] (R1 AC1a) — from this group's expenses only.
 * Distinct, case-insensitive prefix match, max 10, most-used first.
 * "Swiggy" and "swiggy" count as one merchant; the most recently used spelling is returned.
 */
export async function listMerchants(req: Request, res: Response): Promise<void> {
  const { q } = req.query as MerchantQuery;
  const merchantMatch = q ? new RegExp(`^${escapeRegex(q)}`, 'i') : { $nin: [null, ''] };

  const rows = await Expense.aggregate<{ name: string }>([
    { $match: { groupId: groupIdOf(req), deletedAt: null, merchant: merchantMatch } },
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
  const { filter, from, to } = buildExpenseFilter(req.query as unknown as ExpenseFilter, groupIdOf(req));

  // lean(): plain objects, no Mongoose document overhead — faster for thousands of rows.
  const expenses = await Expense.find(filter)
    .sort({ date: -1, _id: -1 })
    .populate<{ category: ICategory | null }>('category', 'name')
    .populate<{ user: { name: string } | null }>('user', 'name')
    .lean();

  const ddmmyyyy = (d: Date) => toIsoDate(d).split('-').reverse().join('-'); // 2026-11-06 → 06-11-2026
  const csv = toCsv(
    ['Date', 'User', 'Category', 'Amount', 'Merchant', 'Payment Method', 'Note'],
    expenses.map((e) => [
      ddmmyyyy(e.date),
      e.user?.name ?? '', // member name (R12 v2); empty if the account was deleted
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
  const expense = await findActiveOr404(req);
  await expense.populate(EXPENSE_POPULATE);
  res.json(expense);
}

/** POST /api/expenses → 201 (R1). */
export async function createExpense(req: Request, res: Response): Promise<void> {
  const expense = await Expense.create(await toExpenseFields(req, req.body as ExpenseBody));
  await expense.populate(EXPENSE_POPULATE);
  res.status(201).json(expense);
}

/** PUT /api/expenses/:id — full replace, same body as POST (R3). */
export async function updateExpense(req: Request, res: Response): Promise<void> {
  const expense = await findActiveOr404(req);
  expense.set(await toExpenseFields(req, req.body as ExpenseBody, expense));
  await expense.save();
  await expense.populate(EXPENSE_POPULATE);
  res.json(expense);
}

/** DELETE /api/expenses/:id → 204. Soft delete: sets deletedAt so Undo can restore (R4). */
export async function deleteExpense(req: Request, res: Response): Promise<void> {
  const expense = await findActiveOr404(req);
  expense.deletedAt = new Date();
  await expense.save();
  res.status(204).end();
}

/** POST /api/expenses/:id/restore — Undo (R4 AC2). Restoring an active expense is a no-op. */
export async function restoreExpense(req: Request, res: Response): Promise<void> {
  const groupId: Types.ObjectId = groupIdOf(req);
  const expense = await Expense.findOne({ _id: req.params.id as string, groupId });
  if (!expense) throw new HttpError(404, 'Expense not found');

  expense.deletedAt = null;
  // Its category may have been deleted while the expense was soft-deleted
  // (category delete only counts active expenses) → fall back to this group's "Other".
  if (!(await Category.exists({ _id: expense.categoryId, groupId }))) {
    const other = await Category.findOne({ groupId, isSystem: true });
    if (other) expense.categoryId = other._id;
  }
  await expense.save();
  await expense.populate(EXPENSE_POPULATE);
  res.json(expense);
}
