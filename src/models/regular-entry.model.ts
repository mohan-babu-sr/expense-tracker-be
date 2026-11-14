import { Schema, Types, model } from 'mongoose';
import { toJsonOptions } from './to-json';

/**
 * One month's copy of a regular item — design §12.2 (R18 AC3). Created by `ensureEntries()` for plan months up to
 * the current month; its amount can differ from the template for that month only, and it carries the Paid tick.
 */
export interface IRegularEntry {
  groupId: Types.ObjectId;
  itemId: Types.ObjectId;
  /** `YYYY-MM`. */
  month: string;
  /** Copy of the item's name at creation — past months keep their wording if the item is renamed. */
  name: string;
  amount: number;
  paidAt: Date | null;
  paidBy: Types.ObjectId | null;
}

const regularEntrySchema = new Schema<IRegularEntry>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    itemId: { type: Schema.Types.ObjectId, ref: 'RegularItem', required: true },
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    amount: { type: Number, required: true, min: 0.01 },
    paidAt: { type: Date, default: null },
    paidBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'regularentries', timestamps: true, toJSON: toJsonOptions },
);

// One entry per item per month — makes concurrent ensureEntries() calls safe (the 2nd upsert is a no-op).
regularEntrySchema.index({ groupId: 1, itemId: 1, month: 1 }, { unique: true });
regularEntrySchema.index({ groupId: 1, month: 1 });

export const RegularEntry = model<IRegularEntry>('RegularEntry', regularEntrySchema);
