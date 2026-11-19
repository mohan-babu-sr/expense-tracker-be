import { HydratedDocument, Schema, model } from 'mongoose';

/** How long "already sent" records are kept — covers a month's budget keys and any reminder window. */
export const PUSH_LOG_TTL_SECONDS = 120 * 24 * 60 * 60;

/**
 * "This notification was already sent" — design §16.2 (R28 AC3, AC4, AC8).
 * The unique `key` (e.g. `upc:<userId>:<itemId>:<dueDate>:before`) makes every send happen at most once:
 * inserting it is the claim, a duplicate-key error means someone already sent it. That makes the daily run
 * safe to repeat (cron retries, manual runs) and lets it catch up after a missed day.
 */
export interface IPushLog {
  key: string;
  createdAt: Date;
}

export type PushLogDoc = HydratedDocument<IPushLog>;

const pushLogSchema = new Schema<IPushLog>({
  key: { type: String, required: true, unique: true },
  createdAt: { type: Date, required: true, default: () => new Date() },
});

pushLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: PUSH_LOG_TTL_SECONDS }); // TTL clean-up

export const PushLog = model<IPushLog>('PushLog', pushLogSchema);
