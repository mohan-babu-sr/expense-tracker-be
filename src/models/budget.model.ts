import { Schema, Types, model } from 'mongoose';
import { toJsonOptions } from './to-json';

/** Shape of a budget document — design §1 (R8), §8.2 (per group). */
export interface IBudget {
  groupId: Types.ObjectId;
  /** null = overall monthly budget (R8 AC5). */
  categoryId: Types.ObjectId | null;
  amount: number;
}

const budgetSchema = new Schema<IBudget>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    amount: { type: Number, required: true, min: 0.01 },
  },
  { timestamps: true, toJSON: toJsonOptions },
);

/**
 * One budget per category per group, and — because `null` is a value too — only ONE overall budget per group.
 * There is no month field: a budget applies to every month until changed (R8 AC1).
 */
budgetSchema.index({ groupId: 1, categoryId: 1 }, { unique: true });

budgetSchema.virtual('category', {
  ref: 'Category',
  localField: 'categoryId',
  foreignField: '_id',
  justOne: true,
});

export const Budget = model<IBudget>('Budget', budgetSchema);
