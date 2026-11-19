import type { Types } from 'mongoose';
import webpush, { WebPushError } from 'web-push';
import { env } from '../config/env';
import { PushLog } from '../models/push-log.model';
import { PushSubscription, type PushSubscriptionDoc } from '../models/push-subscription.model';

/**
 * Web Push sending — design §16.4 (R28).
 * `web-push` encrypts each message for the device (aes128gcm) and signs the request with our VAPID key, so the
 * push service (Google / Apple / Microsoft) can deliver it but can't read it.
 */

if (env.PUSH_ENABLED) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
}

/** How long a push service keeps trying a device that is off: a reminder older than a day is stale. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;

export interface PushMessage {
  title: string;
  body: string;
  /** In-app path opened when the notification is tapped, e.g. `/upcoming`. */
  url: string;
  /** Same tag = the new notification replaces the old one on the device (e.g. yesterday's reminders). */
  tag: string;
}

export interface SendResult {
  sent: number;
  failed: number;
  /** Subscriptions deleted because the push service said the device is gone (404 / 410). */
  removed: number;
}

/** A message recorded instead of sent when PUSH_DRY_RUN is on (tests only, design §16.8). */
export interface DryRunRecord extends PushMessage {
  userId: string;
  devices: number;
}

const dryRunLog: DryRunRecord[] = [];

/** Dry run: keep the record in memory and print it, so a test script can read the test server's output. */
function recordDryRun(record: DryRunRecord): void {
  dryRunLog.push(record);
  console.log(`[push dry-run] ${JSON.stringify(record)}`);
}

/** Tests: everything "sent" since the last call, then cleared. */
export function takeDryRunLog(): DryRunRecord[] {
  return dryRunLog.splice(0, dryRunLog.length);
}

/**
 * The payload shape Angular's service worker (`ngsw-worker.js`) understands: it shows `notification`, and on tap
 * `onActionClick.default` focuses an open app window and navigates it to `url`, or opens a new one (R28 AC5).
 */
export function buildPayload(message: PushMessage): string {
  return JSON.stringify({
    notification: {
      title: message.title,
      body: message.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png', // monochrome status-bar icon on Android
      tag: message.tag,
      renotify: false,
      data: {
        onActionClick: {
          default: { operation: 'navigateLastFocusedOrOpen', url: message.url },
        },
      },
    },
  });
}

/** True when the push service says this subscription no longer exists (app uninstalled, permission revoked…). */
function isGone(err: unknown): boolean {
  return err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410);
}

/** Sends to one device. Gone → the subscription is deleted (R28 AC8). Never logs the endpoint (a capability URL). */
async function sendToSubscription(sub: PushSubscriptionDoc, payload: string): Promise<'sent' | 'failed' | 'removed'> {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, {
      TTL: PUSH_TTL_SECONDS,
      urgency: 'normal',
    });
    await PushSubscription.updateOne({ _id: sub._id }, { $set: { lastSuccessAt: new Date() } });
    return 'sent';
  } catch (err) {
    if (isGone(err)) {
      await PushSubscription.deleteOne({ _id: sub._id });
      return 'removed';
    }
    const status = err instanceof WebPushError ? err.statusCode : undefined;
    console.error(`Push to subscription ${sub.id} failed (status ${status ?? 'n/a'}):`, (err as Error).message);
    return 'failed';
  }
}

function tally(outcomes: Array<'sent' | 'failed' | 'removed'>): SendResult {
  return {
    sent: outcomes.filter((o) => o === 'sent').length,
    failed: outcomes.filter((o) => o === 'failed').length,
    removed: outcomes.filter((o) => o === 'removed').length,
  };
}

/** Sends one message to every device of a user. With no devices it does nothing (all zeros). */
export async function sendToUser(userId: Types.ObjectId, message: PushMessage): Promise<SendResult> {
  const subs = await PushSubscription.find({ userId });
  if (!subs.length) return { sent: 0, failed: 0, removed: 0 };
  if (env.PUSH_DRY_RUN) {
    recordDryRun({ ...message, userId: userId.toString(), devices: subs.length });
    return { sent: subs.length, failed: 0, removed: 0 };
  }
  if (!env.PUSH_ENABLED) return { sent: 0, failed: subs.length, removed: 0 };
  const payload = buildPayload(message);
  return tally(await Promise.all(subs.map((s) => sendToSubscription(s, payload))));
}

/** Sends to one specific device of a user (Settings → Send test notification, R28 AC6). */
export async function sendToEndpoint(
  userId: Types.ObjectId,
  endpoint: string,
  message: PushMessage,
): Promise<'sent' | 'failed' | 'removed' | 'not-found'> {
  const sub = await PushSubscription.findOne({ userId, endpoint });
  if (!sub) return 'not-found';
  if (env.PUSH_DRY_RUN) {
    recordDryRun({ ...message, userId: userId.toString(), devices: 1 });
    return 'sent';
  }
  if (!env.PUSH_ENABLED) return 'failed';
  return sendToSubscription(sub, buildPayload(message));
}

/** Every device of these users stops getting notifications (sign out of all devices, disable, delete — R28 AC7). */
export async function removeSubscriptionsOf(userId: Types.ObjectId): Promise<number> {
  const { deletedCount } = await PushSubscription.deleteMany({ userId });
  return deletedCount;
}

/** MongoDB duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/**
 * Claims a "send once" key (design §16.2). True = ours to send; false = already sent earlier.
 * Claimed BEFORE sending so two runs at the same time can't both send it.
 */
export async function claim(key: string): Promise<boolean> {
  try {
    await PushLog.create({ key });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === DUPLICATE_KEY) return false;
    throw err;
  }
}

/** Gives a claim back, so the next run retries (used when no device accepted the message). */
export async function unclaim(key: string): Promise<void> {
  await PushLog.deleteOne({ key });
}

/**
 * Claim + send + unclaim-on-failure in one step, for the reminder and budget services (T88, T89).
 * Returns null when the key was already claimed (nothing sent).
 */
export async function sendOnce(
  key: string,
  userId: Types.ObjectId,
  message: PushMessage,
): Promise<SendResult | null> {
  if (!(await claim(key))) return null;
  const result = await sendToUser(userId, message).catch(async (err) => {
    await unclaim(key);
    throw err;
  });
  // Nobody received it, but at least one device is still there and failed for a temporary reason → retry later.
  if (result.sent === 0 && result.failed > 0) await unclaim(key);
  return result;
}
