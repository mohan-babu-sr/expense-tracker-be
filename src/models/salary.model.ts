import { Schema, Types, model } from 'mongoose';
import { toJsonOptions } from './to-json';

/**
 * One member's salary for one month — design §12.2 (R17). Entered per month, never carried over (R17 AC1).
 * Any member may set any member's salary (R17 AC2), so `updatedBy` records who changed it last.
 */
export interface ISalary {
  groupId: Types.ObjectId;
  userId: Types.ObjectId;
  /** `YYYY-MM`, same format as the expense `month` filter. */
  month: string;
  /** ≥ 0 — 0 means "no income this month", which still counts as entered. */
  amount: number;
  updatedBy: Types.ObjectId;
}

const salarySchema = new Schema<ISalary>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    amount: { type: Number, required: true, min: 0 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, toJSON: toJsonOptions },
);

// One salary per member per month; also serves "all salaries of a month" and the salary gate's exists() check.
salarySchema.index({ groupId: 1, month: 1, userId: 1 }, { unique: true });

export const Salary = model<ISalary>('Salary', salarySchema);
