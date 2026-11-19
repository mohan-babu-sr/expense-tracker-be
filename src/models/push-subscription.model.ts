import { HydratedDocument, Schema, Types, model } from 'mongoose';
import { toJsonOptionsWithout } from './to-json';

/** Most devices one account keeps notifications on; the oldest is dropped beyond this (design §16.3). */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

/**
 * One device (browser / installed app) that turned notifications on — design §16.2 (R28 AC1).
 * `endpoint` is the push service URL the browser gave us; together with `keys` it lets the server send
 * end-to-end encrypted messages to that device. Treated as secret-ish: never sent back to any client.
 * No groupId: the user's group is looked up when sending, so a user moved to another group gets the new
 * group's items (R28 AC7).
 */
export interface IPushSubscription {
  userId: Types.ObjectId;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** e.g. "Chrome on Android" — for logs only. */
  deviceName: string;
  /** Last time a push service accepted a message for this device. */
  lastSuccessAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PushSubscriptionDoc = HydratedDocument<IPushSubscription>;

const pushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true, maxlength: 1000 },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    deviceName: { type: String, required: true, trim: true, maxlength: 40 },
    lastSuccessAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    // Safety net: even if a whole document is sent by mistake, the endpoint and keys stay on the server.
    toJSON: toJsonOptionsWithout('endpoint', 'keys', 'userId'),
  },
);

export const PushSubscription = model<IPushSubscription>('PushSubscription', pushSubscriptionSchema);
