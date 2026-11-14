import type { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { groupIdOf } from '../middleware/auth';
import { HttpError } from '../middleware/error-handler';
import { RegularEntry } from '../models/regular-entry.model';
import { RegularItem } from '../models/regular-item.model';
import { Salary } from '../models/salary.model';
import { User } from '../models/user.model';
import { currentMonth } from '../services/date-utils';
import { monthLabel, monthPlan, planStartOf, toEntryView } from '../services/plan';
import type { PlanQuery, RegularEntryBody, SalaryBody } from '../validators/plan.schema';

/* Monthly plan — design §12.4. Every member may read and write (R17 AC2, R18 AC5); all queries group-scoped. */

/** GET /api/plan?month= → PlanMonth (R17–R19 AC1–AC3). */
export async function getPlan(req: Request, res: Response): Promise<void> {
  const month = (req.query as PlanQuery).month ?? currentMonth();
  res.json(await monthPlan(groupIdOf(req), month));
}

/**
 * PUT /api/plan/salaries/:userId?month= — set one member's salary for a month (R17 AC1–AC2, AC5) → PlanMonth.
 * userId must be an ACTIVE member of the caller's group, else 404 (same rule as member limits).
 * Months before the plan start are refused: they are never counted, so a salary there would only confuse.
 */
export async function setSalary(req: Request, res: Response): Promise<void> {
  const groupId = groupIdOf(req);
  const userId = req.params.userId as string;
  const month = (req.query as PlanQuery).month ?? currentMonth();
  const { amount } = req.body as SalaryBody;

  const member = isValidObjectId(userId) ? await User.exists({ _id: userId, groupId, status: 'active' }) : null;
  if (!member) throw new HttpError(404, 'Member not found');

  const start = await planStartOf(groupId);
  if (start === null || month < start) {
    const when = start ? `starts in ${monthLabel(start)}` : 'has not started yet';
    throw new HttpError(400, `The monthly plan ${when}`, { month: 'Before the plan start' });
  }

  // Upsert on the unique { groupId, month, userId } key: first save creates, later saves edit (R17 AC5).
  await Salary.findOneAndUpdate(
    { groupId, month, userId },
    { amount: Math.round(amount * 100) / 100, updatedBy: req.user!.id },
    { upsert: true, runValidators: true },
  );
  res.json(await monthPlan(groupId, month));
}

/**
 * PUT /api/plan/regular-entries/:id — this month's amount (that month only) and/or the Paid tick (R18 AC3).
 * Paid keeps the first payer/time when ticked again; unticking clears both.
 */
export async function updateRegularEntry(req: Request, res: Response): Promise<void> {
  const groupId = groupIdOf(req);
  const id = req.params.id as string;
  const { amount, paid } = req.body as RegularEntryBody;

  const entry = isValidObjectId(id) ? await RegularEntry.findOne({ _id: id, groupId }) : null;
  if (!entry) throw new HttpError(404, 'Regular entry not found');

  if (amount !== undefined) entry.amount = Math.round(amount * 100) / 100;
  if (paid === true && !entry.paidAt) {
    entry.paidAt = new Date();
    entry.paidBy = req.user!._id;
  } else if (paid === false) {
    entry.paidAt = null;
    entry.paidBy = null;
  }
  await entry.save();

  const [item, payer] = await Promise.all([
    RegularItem.findById(entry.itemId, { every: 1 }).lean(),
    entry.paidBy ? User.findById(entry.paidBy, { name: 1 }).lean() : null,
  ]);
  const payerName = new Map(payer ? [[payer._id.toString(), payer.name]] : []);
  res.json(toEntryView(entry, item?.every ?? 1, payerName));
}
