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
 * Who spent it (R12). Fixed list until login exists (v2) — then this becomes a userId reference.
 * Must match the client's `shared/constants/users.ts`.
 */
export const USERS = ['Mohan', 'Abhinaya'] as const;
export type ExpenseUser = (typeof USERS)[number];
export const DEFAULT_USER: ExpenseUser = 'Mohan';

/** Shape of an expense document — design §1 (R1–R4, R6). */
export interface IExpense {
  amount: number;
  categoryId: Types.ObjectId;
  /** Calendar date stored at UTC midnight. */
  date: Date;
  merchant?: string;
  note?: string;
  paymentMethod?: PaymentMethod;
  user: ExpenseUser;
  /** null = active; set on delete so Undo can restore it (R4 AC2). */
  deletedAt: Date | null;
}

const expenseSchema = new Schema<IExpense>(
  {
    amount: { type: Number, required: true, min: 0.01 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    date: { type: Date, required: true },
    merchant: { type: String, trim: true, maxlength: 50 },
    note: { type: String, trim: true, maxlength: 200 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS },
    // `default` also fills the value when an OLD document (saved before R12) is loaded,
    // so the API returns user: 'Mohan' for it without any data migration.
    user: { type: String, enum: USERS, required: true, default: DEFAULT_USER },
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

// Indexes — design §1 (NFR1). `_id` in the sort index keeps paging stable for same-day expenses.
expenseSchema.index({ date: -1, _id: -1 });
expenseSchema.index({ categoryId: 1, date: -1 });
expenseSchema.index({ merchant: 1 });
expenseSchema.index({ user: 1, date: -1 });
expenseSchema.index({ deletedAt: 1 });

export const Expense = model<IExpense>('Expense', expenseSchema);
