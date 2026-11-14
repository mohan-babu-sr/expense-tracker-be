import { z } from 'zod';
import { todayIso } from '../services/date-utils';
import { EXTRA_INCOME_SOURCES } from '../models/extra-income.model';
import { amountSchema, isoDateSchema, monthSchema, optionalTextSchema } from './common.schema';

/** `?month=YYYY-MM` (default: current month) — plan endpoints (design §12.4). */
export const planQuerySchema = z.object({
  month: monthSchema.optional(),
});
export type PlanQuery = z.infer<typeof planQuerySchema>;

/** PUT /plan/salaries/:userId body — R17 AC1: ≥ 0 (0 = no income), at most 2 decimals. */
export const salaryBodySchema = z.object({
  amount: z
    .number({ error: 'Amount is required' })
    .min(0, 'Salary cannot be negative')
    .max(1_00_00_00_000, 'Amount is too large')
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
      message: 'Amount can have at most 2 decimals',
    }),
});
export type SalaryBody = z.infer<typeof salaryBodySchema>;

const MONTH_ORDER_MSG = 'End month must be on or after the start month';

/** POST / PUT /regular-items body — R18 AC1. */
export const regularItemBodySchema = z
  .object({
    name: z
      .string({ error: 'Name is required' })
      .trim()
      .min(1, 'Name is required')
      .max(40, 'Name must be at most 40 characters'),
    amount: amountSchema,
    every: z.union([z.literal(1), z.literal(3), z.literal(4), z.literal(6), z.literal(12)], {
      error: 'Repeats every must be 1, 3, 4, 6 or 12 months',
    }),
    startMonth: monthSchema,
    endMonth: monthSchema.nullable().optional().transform((v) => v ?? null),
    note: optionalTextSchema(200, 'Note'),
  })
  .refine((b) => b.endMonth === null || b.endMonth >= b.startMonth, { message: MONTH_ORDER_MSG, path: ['endMonth'] });
export type RegularItemBody = z.infer<typeof regularItemBodySchema>;

/** PUT /plan/regular-entries/:id body — this month's amount and/or the Paid tick (R18 AC3). */
export const regularEntryBodySchema = z
  .object({
    amount: amountSchema.optional(),
    paid: z.boolean().optional(),
  })
  .refine((b) => b.amount !== undefined || b.paid !== undefined, { message: 'Nothing to change' });
export type RegularEntryBody = z.infer<typeof regularEntryBodySchema>;

/** POST /savings/withdrawals body — R19 AC5. */
export const withdrawalBodySchema = z.object({
  amount: amountSchema,
  date: isoDateSchema.refine((d) => d <= todayIso(), { message: 'Date cannot be in the future' }),
  reason: z
    .string({ error: 'Reason is required' })
    .trim()
    .min(1, 'Reason is required')
    .max(100, 'Reason must be at most 100 characters'),
});
export type WithdrawalBody = z.infer<typeof withdrawalBodySchema>;

/** POST /savings/extra-income body — R20 AC1. The plan-start check needs the group, so it lives in the controller. */
export const extraIncomeBodySchema = z.object({
  amount: amountSchema,
  date: isoDateSchema.refine((d) => d <= todayIso(), { message: 'Date cannot be in the future' }),
  source: z.enum(EXTRA_INCOME_SOURCES, { error: 'Pick a source' }),
  note: optionalTextSchema(100, 'Note'),
});
export type ExtraIncomeBody = z.infer<typeof extraIncomeBodySchema>;
