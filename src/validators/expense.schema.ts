import { z } from 'zod';
import { PAYMENT_METHODS } from '../models/expense.model';
import { todayIso } from '../services/date-utils';
import {
  amountSchema,
  isoDateSchema,
  monthSchema,
  objectIdSchema,
  optionalTextSchema,
} from './common.schema';

/** Body for POST/PUT /expenses — same rules as the Angular form (R1 AC1, NFR3). */
export const expenseBodySchema = z.object({
  amount: amountSchema,
  categoryId: objectIdSchema,
  // YYYY-MM-DD strings compare correctly as text, so `<=` works for "not in the future".
  date: isoDateSchema.refine((d) => d <= todayIso(), { message: 'Date cannot be in the future' }),
  merchant: optionalTextSchema(50, 'Merchant'),
  note: optionalTextSchema(200, 'Note'),
  paymentMethod: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.enum(PAYMENT_METHODS, { error: `Payment method must be one of ${PAYMENT_METHODS.join(', ')}` }).optional(),
  ),
  // R13 AC9: the member who spent it. Missing / null / '' → the signed-in user (decided in the controller,
  // which also checks the id is an active member of the same group).
  userId: z.preprocess((v) => (v === '' || v === null ? undefined : v), objectIdSchema.optional()),
});
export type ExpenseBody = z.infer<typeof expenseBodySchema>;

/** Common expense filters (design §2) — shared by list, export (T5) and totals. */
export const expenseFilterSchema = z
  .object({
    month: monthSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    // "id1,id2" → ['id1', 'id2']
    categoryIds: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []))
      .pipe(z.array(objectIdSchema)),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    userId: objectIdSchema.optional(),
    q: z.string().trim().max(100).optional(),
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, { message: '"from" must be on or before "to"', path: ['to'] });
export type ExpenseFilter = z.infer<typeof expenseFilterSchema>;

/** GET /expenses/merchants?q= (R1 AC1a). Empty q → most-used merchants. */
export const merchantQuerySchema = z.object({
  q: z.string().trim().max(50).optional(),
});
export type MerchantQuery = z.infer<typeof merchantQuerySchema>;

const PAGE_SIZES = [10, 25, 50];

/** GET /expenses query = filters + pagination (NFR1). */
export const expenseListQuerySchema = z.intersection(
  expenseFilterSchema,
  z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .refine((v) => PAGE_SIZES.includes(v), { message: 'pageSize must be 10, 25 or 50' })
      .default(10),
  }),
);
export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;
