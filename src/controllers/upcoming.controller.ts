import type { Request, Response } from 'express';
import { groupIdOf } from '../middleware/auth';
import { HttpError } from '../middleware/error-handler';
import { Category } from '../models/category.model';
import { REPEAT_MONTHS, Upcoming } from '../models/upcoming.model';
import { addMonthsClamped, parseIsoDate } from '../services/date-utils';
import type { UpcomingBody, UpcomingQuery } from '../validators/upcoming.schema';

/*
 * Upcoming (R14, design §9.2). Every query includes groupId (R14 AC7, design §8.2): another group's id → 404.
 * Nothing here creates expenses — the real expense is recorded as usual when it is paid (R14 AC7).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

async function toFields(req: Request, body: UpcomingBody) {
  const groupId = groupIdOf(req);
  if (!(await Category.exists({ _id: body.categoryId, groupId }))) {
    throw new HttpError(400, 'Validation failed', { categoryId: 'Category not found' });
  }
  return {
    groupId,
    title: body.title,
    categoryId: body.categoryId,
    amount: round2(body.amount),
    dueDate: parseIsoDate(body.dueDate),
    repeat: body.repeat,
    note: body.note, // undefined clears it on PUT
  };
}

/** Active (not deleted) item of the caller's group, or 404. */
async function findActiveOr404(req: Request) {
  const item = await Upcoming.findOne({ _id: req.params.id as string, groupId: groupIdOf(req), deletedAt: null });
  if (!item) throw new HttpError(404, 'Upcoming item not found');
  return item;
}

/** GET /api/upcoming?status=open|done — open: due date ascending; done: latest 50 first (R14 AC2, AC5). */
export async function listUpcoming(req: Request, res: Response): Promise<void> {
  const { status } = req.query as unknown as UpcomingQuery;
  const groupId = groupIdOf(req);
  const query =
    status === 'done'
      ? Upcoming.find({ groupId, deletedAt: null, doneAt: { $ne: null } }).sort({ doneAt: -1 }).limit(50)
      : Upcoming.find({ groupId, deletedAt: null, doneAt: null }).sort({ dueDate: 1, _id: 1 });
  res.json(await query.populate('category'));
}

/** POST /api/upcoming → 201 (R14 AC1). */
export async function createUpcoming(req: Request, res: Response): Promise<void> {
  const item = await Upcoming.create(await toFields(req, req.body as UpcomingBody));
  await item.populate('category');
  res.status(201).json(item);
}

/** PUT /api/upcoming/:id — full replace, same body as POST (R14 AC4). */
export async function updateUpcoming(req: Request, res: Response): Promise<void> {
  const item = await findActiveOr404(req);
  item.set(await toFields(req, req.body as UpcomingBody));
  await item.save();
  await item.populate('category');
  res.json(item);
}

/** DELETE /api/upcoming/:id → 204. Soft delete so Undo can restore it (R14 AC4). */
export async function deleteUpcoming(req: Request, res: Response): Promise<void> {
  const item = await findActiveOr404(req);
  item.deletedAt = new Date();
  await item.save();
  res.status(204).end();
}

/** POST /api/upcoming/:id/restore — Undo. Restoring an active item is a no-op. */
export async function restoreUpcoming(req: Request, res: Response): Promise<void> {
  const groupId = groupIdOf(req);
  const item = await Upcoming.findOne({ _id: req.params.id as string, groupId });
  if (!item) throw new HttpError(404, 'Upcoming item not found');
  item.deletedAt = null;
  // Same rule as expenses: its category may have been deleted meanwhile → "Other".
  if (!(await Category.exists({ _id: item.categoryId, groupId }))) {
    const other = await Category.findOne({ groupId, isSystem: true });
    if (other) item.categoryId = other._id;
  }
  await item.save();
  await item.populate('category');
  res.json(item);
}

/**
 * POST /api/upcoming/:id/done → { done, next | null } (R14 AC5).
 * Marks the item done; if it repeats, creates the next one with the same fields and the due date moved by
 * the interval (month-end clamped: 31 Jan + 1 month → 28/29 Feb). Already done → 409, so a double tap
 * cannot create two "next" items.
 */
export async function markUpcomingDone(req: Request, res: Response): Promise<void> {
  const item = await findActiveOr404(req);
  if (item.doneAt) throw new HttpError(409, 'This item is already done');
  item.doneAt = new Date();
  await item.save();

  let next = null;
  if (item.repeat !== 'none') {
    next = await Upcoming.create({
      groupId: item.groupId,
      title: item.title,
      categoryId: item.categoryId,
      amount: item.amount,
      dueDate: addMonthsClamped(item.dueDate, REPEAT_MONTHS[item.repeat]),
      repeat: item.repeat,
      note: item.note,
    });
    await next.populate('category');
  }
  await item.populate('category');
  res.json({ done: item, next });
}
