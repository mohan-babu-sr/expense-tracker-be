import { Schema, Types, model } from 'mongoose';
import { toIsoDate } from '../services/date-utils';
import { toJsonOptions } from './to-json';

/**
 * Money that isn't salary (parents, bonus, gift…) — design §12.2 (R20). It goes straight into overall savings and
 * never touches a month's salary/planned/actual numbers, which is why it is its own collection, not an expense.
 */
export const EXTRA_INCOME_SOURCES = ['parents', 'bonus', 'gift', 'other'] as const;
export type ExtraIncomeSource = (typeof EXTRA_INCOME_SOURCES)[number];

export interface IExtraIncome {
  groupId: Types.ObjectId;
  amount: number;
  /** Calendar date at UTC midnight (same convention as expenses); not in the future, month ≥ plan start. */
  date: Date;
  source: ExtraIncomeSource;
  note?: string;
  /** Who recorded it. */
  userId: Types.ObjectId;
}

const extraIncomeSchema = new Schema<IExtraIncome>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    amount: { type: Number, required: true, min: 0.01 },
    date: { type: Date, required: true },
    source: { type: String, required: true, enum: EXTRA_INCOME_SOURCES },
    note: { type: String, trim: true, maxlength: 100 },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    toJSON: {
      ...toJsonOptions,
      transform: (doc: unknown, ret: Record<string, unknown>) => {
        toJsonOptions.transform(doc, ret);
        if (ret.date instanceof Date) ret.date = toIsoDate(ret.date); // API sends YYYY-MM-DD
        return ret;
      },
    },
  },
);

extraIncomeSchema.index({ groupId: 1, date: -1 });

// Explicit collection name: Mongoose's pluralizer would pick "extraincomes" anyway, but say it so design §12.2 matches.
export const ExtraIncome = model<IExtraIncome>('ExtraIncome', extraIncomeSchema, 'extraincomes');
