import { z } from 'zod';
import { NOTIFY_DAYS_BEFORE } from '../models/user.model';
import { isoDateSchema } from './common.schema';

/** Request bodies for notifications — design §16.3 (R28). */

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/, 'Must be base64url');

/** The push service URL a browser gives us. Always https; length capped like the model. */
export const endpointSchema = z
  .string()
  .trim()
  .max(1000, 'Endpoint is too long')
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Endpoint must be an https URL');

/** POST /me/push-subscriptions — `PushSubscription.toJSON()` from the browser (expirationTime ignored). */
export const subscribeSchema = z.strictObject({
  subscription: z.looseObject({
    endpoint: endpointSchema,
    keys: z.looseObject({
      p256dh: base64url.min(80).max(100),
      auth: base64url.min(16).max(32),
    }),
  }),
  deviceName: z.string().trim().min(1, 'Device name is required').max(40),
});
export type SubscribeBody = z.infer<typeof subscribeSchema>;

/** DELETE /me/push-subscriptions and POST /me/push-subscriptions/test */
export const endpointBodySchema = z.strictObject({ endpoint: endpointSchema });
export type EndpointBody = z.infer<typeof endpointBodySchema>;

/** PUT /me/notify (R28 AC2) — all three fields every time (the dialog sends the whole form). */
export const notifySchema = z.strictObject({
  upcoming: z.boolean(),
  daysBefore: z.union(NOTIFY_DAYS_BEFORE.map((d) => z.literal(d))),
  budget: z.boolean(),
});
export type NotifyBody = z.infer<typeof notifySchema>;

/** POST /push/daily?dryRun=1 */
export const dailyQuerySchema = z.strictObject({
  dryRun: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  /** Tests only (server started with PUSH_DRY_RUN): run as if today were this date. */
  date: isoDateSchema.optional(),
});
export type DailyQuery = z.infer<typeof dailyQuerySchema>;

/** POST /auth/logout — optional: this device's endpoint, so its notifications stop (R28 AC7). */
export const logoutSchema = z.object({ pushEndpoint: endpointSchema.optional() }).catch({});
