import { Schema, Types, model } from 'mongoose';
import { toJsonOptions } from './to-json';

/** "Repeats every N months" choices (R18 AC1). */
export const REGULAR_EVERY = [1, 3, 4, 6, 12] as const;
export type RegularEvery = (typeof REGULAR_EVERY)[number];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * A regular (must-have) item TEMPLATE — design §12.2 (R18). Says what is normally due; each month gets its own
 * `regularentries` copy (amount, Paid tick), so editing the template never rewrites past months (R18 AC5).
 */
export interface IRegularItem {
  groupId: Types.ObjectId;
  name: string;
  amount: number;
  every: RegularEvery;
  /** `YYYY-MM` — first due month. */
  startMonth: string;
  /** `YYYY-MM` or null — last month it can be due (e.g. a policy that matures). */
  endMonth: string | null;
  note?: string;
  /** Soft delete: past entries keep pointing at it (they carry their own name copy anyway). */
  deletedAt: Date | null;
}

const regularItemSchema = new Schema<IRegularItem>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    amount: { type: Number, required: true, min: 0.01 },
    every: { type: Number, enum: REGULAR_EVERY, required: true, default: 1 },
    startMonth: { type: String, required: true, match: MONTH },
    endMonth: { type: String, default: null, match: MONTH },
    note: { type: String, trim: true, maxlength: 200 },
    deletedAt: { type: Date, default: null },
  },
  {
    collection: 'regularitems',
    timestamps: true,
    toJSON: {
      ...toJsonOptions,
      transform: (doc: unknown, ret: Record<string, unknown>) => {
        toJsonOptions.transform(doc, ret);
        delete ret.deletedAt; // internal
        return ret;
      },
    },
  },
);

regularItemSchema.index({ groupId: 1, deletedAt: 1 });

export const RegularItem = model<IRegularItem>('RegularItem', regularItemSchema);
