import { Schema, Types, model } from 'mongoose';
import { toIsoDate } from '../services/date-utils';
import { toJsonOptions } from './to-json';

export const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'NetBanking', 'Other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Human-readable labels (CSV export). The client has its own `payment-method-label` pipe. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  Cash: 'Cash',
  UPI: 'UPI',
  Card: 'Card',
  NetBanking: 'Net Banking',
  Other: 'Other',
};

/**
 * Populate spec used by every endpoint that returns expenses: the category, and the member who spent it
 * (name only — never mobile or anything else about the user).
 */
export const EXPENSE_POPULATE = [{ path: 'category' }, { path: 'user', select: 'name' }];

/** Shape of an expense document — design §1 (R1–R4, R6), §8.2 (group + member). */
export interface IExpense {
  groupId: Types.ObjectId;
  amount: number;
  categoryId: Types.ObjectId;
  /** Calendar date stored at UTC midnight. */
  date: Date;
  merchant?: string;
  note?: string;
  paymentMethod?: PaymentMethod;
  /** Member who spent it (R13 AC9; replaces R12's fixed name list). */
  userId: Types.ObjectId;
  /** null = active; set on delete so Undo can restore it (R4 AC2). */
  deletedAt: Date | null;
}

const expenseSchema = new Schema<IExpense>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    amount: { type: Number, required: true, min: 0.01 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    date: { type: Date, required: true },
    merchant: { type: String, trim: true, maxlength: 50 },
    note: { type: String, trim: true, maxlength: 200 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      ...toJsonOptions,
      transform: (doc: unknown, ret: Record<string, unknown>) => {
        toJsonOptions.transform(doc, ret);
        if (ret.date instanceof Date) ret.date = toIsoDate(ret.date); // API sends YYYY-MM-DD
        delete ret.deletedAt; // internal: clients only ever see active expenses
        return ret;
      },
    },
  },
);

/**
 * `category` virtual: `.populate('category')` fills it with the category document,
 * while `categoryId` stays a plain id. The client gets both.
 */
expenseSchema.virtual('category', {
  ref: 'Category',
  localField: 'categoryId',
  foreignField: '_id',
  justOne: true,
});

/** `user` virtual: populated with `{ id, name }` of the member (see EXPENSE_POPULATE). */
expenseSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true,
});

// Indexes — design §1 (NFR1), §8.2: every query filters by groupId first, so it leads every index.
// `_id` in the sort index keeps paging stable for same-day expenses.
expenseSchema.index({ groupId: 1, date: -1, _id: -1 });
expenseSchema.index({ groupId: 1, categoryId: 1, date: -1 });
expenseSchema.index({ groupId: 1, merchant: 1 });
expenseSchema.index({ groupId: 1, userId: 1, date: -1 });
// T41: MongoDB permanently removes soft-deleted expenses 30 days after deletion. Partial = only documents whose
// deletedAt is a real date are indexed, so active expenses (null) can never expire.
expenseSchema.index(
  { deletedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60, partialFilterExpression: { deletedAt: { $type: 'date' } } },
);

export const Expense = model<IExpense>('Expense', expenseSchema);
