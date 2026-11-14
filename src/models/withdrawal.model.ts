import { Schema, Types, model } from 'mongoose';
import { toIsoDate } from '../services/date-utils';
import { toJsonOptions } from './to-json';

/** Money taken out of the group's savings — design §12.2 (R19 AC5). */
export interface IWithdrawal {
  groupId: Types.ObjectId;
  amount: number;
  /** Calendar date at UTC midnight (same convention as expenses); not in the future. */
  date: Date;
  reason: string;
  /** Who recorded it. */
  userId: Types.ObjectId;
}

const withdrawalSchema = new Schema<IWithdrawal>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    amount: { type: Number, required: true, min: 0.01 },
    date: { type: Date, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 100 },
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

withdrawalSchema.index({ groupId: 1, date: -1 });

export const Withdrawal = model<IWithdrawal>('Withdrawal', withdrawalSchema);
