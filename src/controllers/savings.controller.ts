import type { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { groupIdOf } from '../middleware/auth';
import { HttpError } from '../middleware/error-handler';
import { ExtraIncome } from '../models/extra-income.model';
import { Withdrawal } from '../models/withdrawal.model';
import { parseIsoDate } from '../services/date-utils';
import { monthLabel, planStartOf } from '../services/plan';
import { getSavings } from '../services/savings';
import type { ExtraIncomeBody, WithdrawalBody } from '../validators/plan.schema';

/* Savings tracker — R19 AC4–AC6 + extra income R20, design §12.4. Every member; group-scoped. */

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);

/** GET /api/savings → overall, this month so far, history, withdrawals. */
export async function getSavingsSummary(req: Request, res: Response): Promise<void> {
  res.json(await getSavings(groupIdOf(req)));
}

/**
 * POST /api/savings/withdrawals → 201 + the updated savings summary.
 * R19 AC5: more than the current overall savings → 409 NOT_ENOUGH_SAVINGS ("Only ₹X saved").
 */
export async function createWithdrawal(req: Request, res: Response): Promise<void> {
  const groupId = groupIdOf(req);
  const body = req.body as WithdrawalBody;
  const amount = Math.round(body.amount * 100) / 100;

  const { overall } = await getSavings(groupId);
  if (amount > overall) {
    const message = overall > 0 ? `Only ${inr(overall)} saved` : 'There are no savings to withdraw yet';
    throw new HttpError(409, message, { amount: message }, { code: 'NOT_ENOUGH_SAVINGS', overall });
  }

  await Withdrawal.create({ groupId, amount, date: parseIsoDate(body.date), reason: body.reason, userId: req.user!._id });
  res.status(201).json(await getSavings(groupId));
}

/**
 * POST /api/savings/extra-income → 201 + the updated savings summary (R20 AC1–AC2).
 * Dated before the plan start (or plan not started) → 400 on `date`, so it can't sneak in an "opening balance".
 */
export async function createExtraIncome(req: Request, res: Response): Promise<void> {
  const groupId = groupIdOf(req);
  const body = req.body as ExtraIncomeBody;
  const start = await planStartOf(groupId);
  if (start === null || body.date.slice(0, 7) < start) {
    const message = start ? `The plan starts in ${monthLabel(start)} — pick a date from then on` : 'The plan has not started yet';
    throw new HttpError(400, message, { date: message });
  }

  await ExtraIncome.create({
    groupId,
    amount: Math.round(body.amount * 100) / 100,
    date: parseIsoDate(body.date),
    source: body.source,
    note: body.note,
    userId: req.user!._id,
  });
  res.status(201).json(await getSavings(groupId));
}

/** DELETE /api/savings/extra-income/:id → 204 (hard delete after confirm; may make overall negative — R20 AC4). */
export async function deleteExtraIncome(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const result = isValidObjectId(id) ? await ExtraIncome.deleteOne({ _id: id, groupId: groupIdOf(req) }) : null;
  if (!result?.deletedCount) throw new HttpError(404, 'Extra income not found');
  res.status(204).end();
}

/** DELETE /api/savings/withdrawals/:id → 204 (hard delete; the client confirms first). */
export async function deleteWithdrawal(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const result = isValidObjectId(id) ? await Withdrawal.deleteOne({ _id: id, groupId: groupIdOf(req) }) : null;
  if (!result?.deletedCount) throw new HttpError(404, 'Withdrawal not found');
  res.status(204).end();
}
