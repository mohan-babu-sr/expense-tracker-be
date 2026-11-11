import { Schema, Types, model } from 'mongoose';
import { toIsoDate } from '../services/date-utils';
import { toJsonOptions } from './to-json';

/** Repeat options (R14 AC1) and how many months each one moves the due date (R14 AC5). */
export const REPEATS = ['none', 'monthly', 'quarterly', 'half_yearly', 'yearly'] as const;
export type Repeat = (typeof REPEATS)[number];
export const REPEAT_MONTHS: Record<Exclude<Repeat, 'none'>, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

/** A planned big payment / event — design §9.1 (R14). Belongs to one group (R14 AC7). */
export interface IUpcoming {
  groupId: Types.ObjectId;
  title: string;
  categoryId: Types.ObjectId;
  /** Estimated amount. */
  amount: number;
  /** Calendar date at UTC midnight; past dates allowed (shown as overdue). */
  dueDate: Date;
  repeat: Repeat;
  note?: string;
  /** null = open; set by "Mark done" (R14 AC5). */
  doneAt: Date | null;
  /** null = active; set on delete so Undo can restore it (R14 AC4). */
  deletedAt: Date | null;
}

const upcomingSchema = new Schema<IUpcoming>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    title: { type: String, required: true, trim: true, maxlength: 60 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    amount: { type: Number, required: true, min: 0.01 },
    dueDate: { type: Date, required: true },
    repeat: { type: String, enum: REPEATS, required: true, default: 'none' },
    note: { type: String, trim: true, maxlength: 200 },
    doneAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  {
    // The collection is literally "upcoming" (Mongoose would otherwise pluralise it to "upcomings").
    collection: 'upcoming',
    timestamps: true,
    toJSON: {
      ...toJsonOptions,
      transform: (doc: unknown, ret: Record<string, unknown>) => {
        toJsonOptions.transform(doc, ret);
        if (ret.dueDate instanceof Date) ret.dueDate = toIsoDate(ret.dueDate); // API sends YYYY-MM-DD
        delete ret.deletedAt; // internal
        return ret;
      },
    },
  },
);

upcomingSchema.virtual('category', {
  ref: 'Category',
  localField: 'categoryId',
  foreignField: '_id',
  justOne: true,
});

// Open list = { groupId, doneAt: null } sorted by dueDate — design §9.1.
upcomingSchema.index({ groupId: 1, doneAt: 1, dueDate: 1 });
// T41: deleted items are removed permanently 30 days after deletion (same rule as expenses). "Done" items are
// not affected — they have doneAt set but deletedAt null.
upcomingSchema.index(
  { deletedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60, partialFilterExpression: { deletedAt: { $type: 'date' } } },
);

export const Upcoming = model<IUpcoming>('Upcoming', upcomingSchema);
