import type { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { groupIdOf } from '../middleware/auth';
import { HttpError } from '../middleware/error-handler';
import { RegularItem, type IRegularItem } from '../models/regular-item.model';
import { currentMonth } from '../services/date-utils';
import { nextDueMonth, syncCurrentEntry } from '../services/plan';
import type { RegularItemBody } from '../validators/plan.schema';

/* Regular item templates — R18, design §12.3–12.4. Every member may manage them (R18 AC5); group-scoped. */

/** Item JSON + `nextDue` ('YYYY-MM' or null when it has ended) for the Regular items tab. */
function withNextDue(item: { toJSON(): unknown } & Pick<IRegularItem, 'startMonth' | 'endMonth' | 'every'>) {
  return { ...(item.toJSON() as object), nextDue: nextDueMonth(item, currentMonth()) };
}

const fieldsOf = (b: RegularItemBody) => ({
  name: b.name,
  amount: Math.round(b.amount * 100) / 100,
  every: b.every,
  startMonth: b.startMonth,
  endMonth: b.endMonth,
  note: b.note,
});

async function findOr404(req: Request) {
  const id = req.params.id as string;
  const item = isValidObjectId(id) ? await RegularItem.findOne({ _id: id, groupId: groupIdOf(req), deletedAt: null }) : null;
  if (!item) throw new HttpError(404, 'Regular item not found');
  return item;
}

/** GET /api/regular-items — not deleted, by name. */
export async function listRegularItems(req: Request, res: Response): Promise<void> {
  const items = await RegularItem.find({ groupId: groupIdOf(req), deletedAt: null }).collation({ locale: 'en' }).sort({ name: 1 });
  res.json(items.map(withNextDue));
}

/**
 * POST /api/regular-items → 201. Nothing else to do: the next GET /plan creates this month's entry if it's due
 * (ensureEntries adds missing entries — also for past plan months that were never opened).
 */
export async function createRegularItem(req: Request, res: Response): Promise<void> {
  const item = await RegularItem.create({ groupId: groupIdOf(req), ...fieldsOf(req.body as RegularItemBody) });
  res.status(201).json(withNextDue(item));
}

/** PUT /api/regular-items/:id — current & future months follow; past and paid entries stay (R18 AC5). */
export async function updateRegularItem(req: Request, res: Response): Promise<void> {
  const item = await findOr404(req);
  item.set(fieldsOf(req.body as RegularItemBody));
  await item.save();
  await syncCurrentEntry(item);
  res.json(withNextDue(item));
}

/** DELETE /api/regular-items/:id → 204. Soft delete; removes this month's unpaid entry, past months keep theirs. */
export async function deleteRegularItem(req: Request, res: Response): Promise<void> {
  const item = await findOr404(req);
  item.deletedAt = new Date();
  await item.save();
  await syncCurrentEntry(item);
  res.status(204).end();
}
