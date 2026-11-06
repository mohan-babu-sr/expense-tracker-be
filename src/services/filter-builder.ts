import { Types, type QueryFilter } from 'mongoose';
import { DEFAULT_USER, type IExpense } from '../models/expense.model';
import type { ExpenseFilter } from '../validators/expense.schema';
import { addDays, currentMonth, monthRange, parseIsoDate, toIsoDate } from './date-utils';

export interface BuiltExpenseFilter {
  /** MongoDB filter — always includes `deletedAt: null`. */
  filter: QueryFilter<IExpense>;
  /** Inclusive date range as YYYY-MM-DD (null = open-ended). Used for the CSV file name (T5). */
  from: string | null;
  to: string | null;
}

/** Escapes regex special characters so a search for "a.b" or "(" is treated literally. */
export const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds the expense query from validated filters — design §2 "Common expense filters" (R6).
 * Values are real ObjectIds/Dates (not strings) because aggregation pipelines don't auto-cast.
 */
export function buildExpenseFilter(f: ExpenseFilter): BuiltExpenseFilter {
  const filter: QueryFilter<IExpense> = { deletedAt: null };
  let from: string | null;
  let to: string | null;

  if (f.from || f.to) {
    // Custom range overrides month. Either end may be omitted.
    from = f.from ?? null;
    to = f.to ?? null;
    filter.date = {
      ...(from && { $gte: parseIsoDate(from) }),
      ...(to && { $lt: addDays(parseIsoDate(to), 1) }), // inclusive "to": < next day
    };
  } else {
    const month = f.month ?? currentMonth();
    const { start, end } = monthRange(month);
    filter.date = { $gte: start, $lt: end };
    from = toIsoDate(start);
    to = toIsoDate(addDays(end, -1));
  }

  if (f.categoryIds.length) {
    filter.categoryId = { $in: f.categoryIds.map((id) => new Types.ObjectId(id)) };
  }
  if (f.paymentMethod) {
    filter.paymentMethod = f.paymentMethod;
  }
  if (f.user) {
    // Queries don't see schema defaults: expenses saved before R12 have NO `user` field but count as
    // the default user. `null` in $in matches both null and a missing field.
    filter.user = f.user === DEFAULT_USER ? { $in: [DEFAULT_USER, null] } : f.user;
  }
  if (f.q) {
    const regex = new RegExp(escapeRegex(f.q), 'i');
    filter.$or = [{ note: regex }, { merchant: regex }];
  }

  return { filter, from, to };
}
