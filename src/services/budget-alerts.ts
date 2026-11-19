import type { Response } from 'express';
import type { Types } from 'mongoose';
import { PushSubscription } from '../models/push-subscription.model';
import { User } from '../models/user.model';
import { getBudgetStatuses, type BudgetLevel } from './budget-status';
import { currentMonth } from './date-utils';
import { sendOnce, type PushMessage } from './push';
import { rupees } from './upcoming-reminders';

/**
 * Budget warnings — design §16.4 (R28 AC4). Checked right after an expense of the CURRENT month is saved, since
 * that's the moment a budget crosses 80% or 100%. Uses the same statuses as the Budgets page (R8 AC3, §10.2).
 * Each (user, month, budget, level) is sent once through the push log, so going back under and over again in the
 * same month sends nothing, and next month starts fresh (the month is in the key).
 */

type Alert = { scope: string; level: Exclude<BudgetLevel, 'ok'>; message: PushMessage; onlyFor?: string };

const pct = (percent: number) => `${Math.floor(percent)}%`; // floor: never "80%" while still below the line

function budgetMessage(name: string, level: Alert['level'], spent: number, budget: number, percent: number, tag: string): PushMessage {
  const base = { url: '/budgets', tag };
  return level === 'warning'
    ? { ...base, title: `${name} budget at ${pct(percent)}`, body: `${rupees(spent)} of ${rupees(budget)} spent this month` }
    : { ...base, title: `${name} budget exceeded`, body: `Over by ${rupees(spent - budget)} · ${rupees(spent)} of ${rupees(budget)}` };
}

export async function checkBudgetAlerts(groupId: Types.ObjectId, month: string): Promise<void> {
  if (month !== currentMonth()) return; // past months: nothing to warn about any more

  // Active members who want budget warnings (missing `notify` = defaults = on) and have a device.
  const members = await User.find({ groupId, status: 'active', 'notify.budget': { $ne: false } }).select('_id');
  const withDevices = await PushSubscription.distinct('userId', { userId: { $in: members.map((m) => m._id) } });
  if (!withDevices.length) return;

  const { overall, members: rows, items } = await getBudgetStatuses(groupId, month);
  const alerts: Alert[] = [];

  for (const item of items) {
    if (item.status === 'ok') continue;
    const category = item.category as { id?: string; name?: string } | null;
    if (!category?.id) continue;
    alerts.push({
      scope: `cat:${category.id}`,
      level: item.status,
      message: budgetMessage(category.name ?? 'Category', item.status, item.spent, item.budget, item.percent, `budget-${category.id}`),
    });
  }
  if (overall && overall.status !== 'ok') {
    alerts.push({
      scope: 'overall',
      level: overall.status,
      message: budgetMessage('Overall', overall.status, overall.spent, overall.budget, overall.percent, 'budget-overall'),
    });
  }
  // Own monthly limit (R15) → only that member.
  for (const row of rows) {
    if (row.status === null || row.status === 'ok' || row.limit === null || row.percent === null) continue;
    const message: PushMessage =
      row.status === 'warning'
        ? { url: '/budgets', tag: 'budget-me', title: `You've used ${pct(row.percent)} of your monthly limit`, body: `${rupees(row.balance!)} left of ${rupees(row.limit)}` }
        : { url: '/budgets', tag: 'budget-me', title: "You're over your monthly limit", body: `Over by ${rupees(-row.balance!)} · limit ${rupees(row.limit)}` };
    alerts.push({ scope: 'me', level: row.status, message, onlyFor: row.user.id });
  }

  for (const userId of withDevices as Types.ObjectId[]) {
    for (const alert of alerts) {
      if (alert.onlyFor && alert.onlyFor !== userId.toString()) continue;
      await sendOnce(`bud:${userId.toString()}:${month}:${alert.scope}:${alert.level}`, userId, alert.message);
    }
  }
}

/**
 * Runs the check AFTER the response has gone out (design §16.4): saving an expense is never slower, and a push
 * problem can never fail it. Errors are only logged.
 */
export function budgetAlertsAfterResponse(res: Response, groupId: Types.ObjectId, month: string): void {
  res.on('finish', () => {
    if (res.statusCode >= 300) return;
    checkBudgetAlerts(groupId, month).catch((err) =>
      console.error('Budget alerts failed:', (err as Error).message),
    );
  });
}
