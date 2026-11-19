import type { Types } from 'mongoose';
import { PushLog } from '../models/push-log.model';
import { PushSubscription } from '../models/push-subscription.model';
import { Upcoming } from '../models/upcoming.model';
import { User, type UserDoc } from '../models/user.model';
import { addDays, parseIsoDate, toIsoDate, todayIso } from './date-utils';
import { claim, sendToUser, unclaim, type PushMessage } from './push';

/**
 * Daily Upcoming reminders — design §16.4 (R28 AC3, AC8). Called once a day by cron-job.org (POST /push/daily).
 *
 * Each open item is reminded at most three times, at its CURRENT stage only:
 *   before  — 1 ≤ days left ≤ the user's "days before" (1 / 3 / 7)
 *   day     — due today
 *   overdue — 1 to 7 days overdue (older ones aren't announced: e.g. long-forgotten items on the first run)
 * Stages are ranges, not exact days, so a missed run is caught up the next day; the push log makes each
 * (user, item, due date, stage) go out once, so running twice the same day sends nothing new.
 */

type Stage = 'before' | 'day' | 'overdue';

/** Largest "days before" choice — the query window (NOTIFY_DAYS_BEFORE). */
const MAX_DAYS_BEFORE = 7;
/** Overdue items older than this aren't announced any more. */
const OVERDUE_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;

interface DueItem {
  id: string;
  title: string;
  amount: number;
  dueIso: string;
  daysLeft: number;
  category: string;
}

export interface DailyPreview {
  userId: string;
  title: string;
  body: string;
  url: string;
}

export interface DailySummary {
  date: string;
  /** Users with Upcoming notifications on and at least one device. */
  users: number;
  /** Users who got a notification (dry run: would get one). */
  notified: number;
  /** Users with nothing new today. */
  skipped: number;
  /** Devices: delivered / failed / removed because gone. */
  sent: number;
  failed: number;
  removed: number;
  dryRun: boolean;
  preview?: DailyPreview[];
}

function stageOf(daysLeft: number, daysBefore: number): Stage | null {
  if (daysLeft < 0) return daysLeft >= -OVERDUE_WINDOW_DAYS ? 'overdue' : null;
  if (daysLeft === 0) return 'day';
  return daysLeft <= daysBefore ? 'before' : null;
}

/** Same words as the client's `days-left` pipe (R14 AC2), lower-case for use inside a sentence. */
export function daysLeftWords(daysLeft: number): string {
  if (daysLeft < 0) return `overdue by ${-daysLeft} ${daysLeft === -1 ? 'day' : 'days'}`;
  if (daysLeft === 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  return `in ${daysLeft} days`;
}

/** ₹18,000 / ₹1,250.50 / ₹1,20,000 — Indian digit grouping; paise only when there are any. */
export function rupees(n: number): string {
  const digits = Number.isInteger(n) ? 0 : 2;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** One notification for all of a user's reminders today (R28 AC3). Items arrive sorted by due date. */
export function reminderMessage(items: DueItem[]): PushMessage {
  const base = { url: '/upcoming', tag: 'upcoming' }; // same tag → replaces yesterday's on the device
  if (items.length === 1) {
    const [i] = items;
    return { ...base, title: `${i.title} — ${daysLeftWords(i.daysLeft)}`, body: `${rupees(i.amount)} · ${i.category}` };
  }
  const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  const shown = items.slice(0, 2).map((i) => `${i.title} (${daysLeftWords(i.daysLeft)})`);
  if (items.length > 2) shown.push(`+${items.length - 2} more`);
  const allOverdue = items.every((i) => i.daysLeft < 0);
  return {
    ...base,
    title: `${items.length} payments ${allOverdue ? 'overdue' : 'coming up'}`,
    body: `${shown.join(', ')} · ${rupees(total)}`,
  };
}

const keyOf = (userId: Types.ObjectId, item: DueItem, stage: Stage) =>
  `upc:${userId.toString()}:${item.id}:${item.dueIso}:${stage}`;

/** Open items of a group in the reminder window, sorted by due date, with days left from `today`. */
async function dueItemsOfGroup(groupId: Types.ObjectId, today: Date): Promise<DueItem[]> {
  const docs = await Upcoming.find({
    groupId,
    doneAt: null,
    deletedAt: null,
    dueDate: { $gte: addDays(today, -OVERDUE_WINDOW_DAYS), $lte: addDays(today, MAX_DAYS_BEFORE) },
  })
    .sort({ dueDate: 1, _id: 1 })
    .populate('category');
  return docs.map((d) => {
    const category = (d as unknown as { category?: { name?: string } | null }).category;
    return {
      id: d.id as string,
      title: d.title,
      amount: d.amount,
      dueIso: toIsoDate(d.dueDate),
      daysLeft: Math.round((d.dueDate.getTime() - today.getTime()) / DAY_MS),
      category: category?.name ?? 'Other',
    };
  });
}

export async function runDaily({ dryRun = false, date = todayIso() } = {}): Promise<DailySummary> {
  const today = parseIsoDate(date);
  const summary: DailySummary = { date, users: 0, notified: 0, skipped: 0, sent: 0, failed: 0, removed: 0, dryRun };
  if (dryRun) summary.preview = [];

  // Active members with Upcoming on (a missing `notify` = defaults = on) and at least one device.
  const withDevices = await PushSubscription.distinct('userId');
  const users = await User.find({ _id: { $in: withDevices }, status: 'active', 'notify.upcoming': { $ne: false } });
  summary.users = users.length;

  const byGroup = new Map<string, UserDoc[]>();
  for (const u of users) byGroup.set(u.groupId.toString(), [...(byGroup.get(u.groupId.toString()) ?? []), u]);

  for (const members of byGroup.values()) {
    const items = await dueItemsOfGroup(members[0].groupId, today);
    for (const user of members) {
      const daysBefore = user.notify?.daysBefore ?? 3;
      const candidates = items
        .map((item) => ({ item, stage: stageOf(item.daysLeft, daysBefore) }))
        .filter((c): c is { item: DueItem; stage: Stage } => c.stage !== null)
        .map((c) => ({ ...c, key: keyOf(user._id, c.item, c.stage) }));

      // Keep only what this user hasn't been told yet. Dry run: look, don't claim.
      const fresh: typeof candidates = [];
      for (const c of candidates) {
        const isNew = dryRun ? !(await PushLog.exists({ key: c.key })) : await claim(c.key);
        if (isNew) fresh.push(c);
      }
      if (!fresh.length) {
        summary.skipped++;
        continue;
      }

      const message = reminderMessage(fresh.map((c) => c.item));
      summary.notified++;
      if (dryRun) {
        summary.preview!.push({ userId: user.id as string, title: message.title, body: message.body, url: message.url });
        continue;
      }
      try {
        const result = await sendToUser(user._id, message);
        summary.sent += result.sent;
        summary.failed += result.failed;
        summary.removed += result.removed;
        // Nobody got it but a device is still there → give the claims back so tomorrow retries (§16.2).
        if (result.sent === 0 && result.failed > 0) await Promise.all(fresh.map((c) => unclaim(c.key)));
      } catch (err) {
        await Promise.all(fresh.map((c) => unclaim(c.key)));
        console.error(`Daily reminders for user ${user.id} failed:`, (err as Error).message);
        summary.failed++;
      }
    }
  }
  return summary;
}
