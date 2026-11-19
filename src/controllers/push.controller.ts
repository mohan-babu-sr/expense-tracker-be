import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import { runDaily } from '../services/upcoming-reminders';
import { HttpError } from '../middleware/error-handler';
import { MAX_PUSH_SUBSCRIPTIONS_PER_USER, PushSubscription } from '../models/push-subscription.model';
import { User } from '../models/user.model';
import { sendToEndpoint } from '../services/push';
import type { DailyQuery, EndpointBody, NotifyBody, SubscribeBody } from '../validators/push.schema';

/** Notifications — design §16.3 (R28). */

const pushDisabled = () =>
  new HttpError(503, 'Notifications are not available on this server', undefined, { code: 'PUSH_DISABLED' });

/** GET /api/push/public-key — the VAPID public key the browser needs to subscribe. Public config, not a secret. */
export function publicKey(_req: Request, res: Response): void {
  if (!env.PUSH_ENABLED) throw pushDisabled();
  res.json({ key: env.VAPID_PUBLIC_KEY });
}

/**
 * POST /api/me/push-subscriptions — this device turns notifications on (R28 AC1), also the silent re-sync on start.
 * Upsert by endpoint: on a shared phone the endpoint moves to whoever is signed in now, so the previous person's
 * alerts stop there. Beyond 10 devices the least recently synced one is dropped.
 */
export async function subscribe(req: Request, res: Response): Promise<void> {
  if (!env.PUSH_ENABLED) throw pushDisabled();
  const { subscription, deviceName } = req.body as SubscribeBody;
  const userId = req.user!._id;
  await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      $set: {
        userId,
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        deviceName,
        updatedAt: new Date(), // counts as "recently used" even when nothing else changed
      },
    },
    { upsert: true, runValidators: true, timestamps: false, setDefaultsOnInsert: true },
  );
  const extra = await PushSubscription.find({ userId })
    .sort({ updatedAt: -1 })
    .skip(MAX_PUSH_SUBSCRIPTIONS_PER_USER)
    .select('_id');
  if (extra.length) await PushSubscription.deleteMany({ _id: { $in: extra.map((s) => s._id) } });
  res.status(204).end();
}

/** DELETE /api/me/push-subscriptions — this device turns notifications off. Own only; unknown is fine (204). */
export async function unsubscribe(req: Request, res: Response): Promise<void> {
  const { endpoint } = req.body as EndpointBody;
  await PushSubscription.deleteOne({ userId: req.user!._id, endpoint });
  res.status(204).end();
}

/** POST /api/me/push-subscriptions/test — "Send test notification" to this device only (R28 AC6). */
export async function testPush(req: Request, res: Response): Promise<void> {
  if (!env.PUSH_ENABLED) throw pushDisabled();
  const { endpoint } = req.body as EndpointBody;
  const result = await sendToEndpoint(req.user!._id, endpoint, {
    title: 'Notifications are on ✓',
    body: "You'll get reminders for upcoming payments and budget warnings here.",
    url: '/settings',
    tag: 'test',
  });
  if (result === 'not-found') throw new HttpError(404, 'This device is not turned on for notifications');
  if (result === 'removed') {
    // The browser's subscription expired — the client subscribes again and retries (design §16.5).
    throw new HttpError(410, 'This device needs to be turned on again', undefined, { code: 'PUSH_GONE' });
  }
  if (result === 'failed') throw new HttpError(502, "Couldn't reach the notification service. Try again later.");
  res.status(204).end();
}

/** Constant-time comparison of the cron key (hashing first makes both sides the same length). */
function cronKeyMatches(given: unknown): boolean {
  if (typeof given !== 'string' || !env.PUSH_CRON_KEY) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(env.PUSH_CRON_KEY).digest();
  return timingSafeEqual(a, b);
}

/**
 * POST /api/push/daily — the daily Upcoming reminders (R28 AC3), called by cron-job.org at 09:00 IST with the
 * `X-Cron-Key` header. `?dryRun=1` sends and records nothing and returns what would be sent (tests).
 * Safe to call more than once a day: already-sent reminders are skipped (design §16.2).
 */
export async function daily(req: Request, res: Response): Promise<void> {
  if (!env.PUSH_ENABLED || !env.PUSH_CRON_KEY) throw pushDisabled();
  if (!cronKeyMatches(req.get('x-cron-key'))) throw new HttpError(401, 'Wrong or missing cron key');
  const { dryRun, date } = req.query as unknown as DailyQuery;
  if (date && !env.PUSH_DRY_RUN) throw new HttpError(400, '`date` is only allowed on a test server');
  res.json(await runDaily({ dryRun, date }));
}

/** PUT /api/me/notify — what I want notifications about, for all my devices (R28 AC2). */
export async function updateNotify(req: Request, res: Response): Promise<void> {
  const notify = req.body as NotifyBody;
  await User.updateOne({ _id: req.user!._id }, { $set: { notify } });
  res.json(notify);
}
