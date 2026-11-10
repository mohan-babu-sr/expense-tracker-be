import type { Types } from 'mongoose';
import { Upcoming } from '../models/upcoming.model';
import { addDays, parseIsoDate, todayIso } from './date-utils';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Open (not done, not deleted) items of a group due on or before today + 30 days — overdue included. */
export const dueSoonFilter = (groupId: Types.ObjectId) => ({
  groupId,
  doneAt: null,
  deletedAt: null,
  dueDate: { $lte: addDays(parseIsoDate(todayIso()), 30) },
});

/**
 * Dashboard "Coming up" card (R14 AC6): up to 5 items due in the next 30 days (overdue first, as they sort
 * earliest) and the total of ALL of them, not just the 5 shown. Independent of the dashboard month.
 */
export async function getComingUp(groupId: Types.ObjectId) {
  const due = await Upcoming.find(dueSoonFilter(groupId)).sort({ dueDate: 1, _id: 1 }).populate('category');
  return {
    items: due.slice(0, 5),
    total: round2(due.reduce((sum, u) => sum + u.amount, 0)),
  };
}
