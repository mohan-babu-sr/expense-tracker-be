import { z } from 'zod';
import { amountSchema, monthSchema, objectIdSchema } from './common.schema';

/** PUT /budgets body — `categoryId: null` sets the overall budget (R8 AC1, AC5). */
export const budgetBodySchema = z.object({
  categoryId: objectIdSchema.nullable(),
  amount: amountSchema,
});
export type BudgetBody = z.infer<typeof budgetBodySchema>;

/** GET /budgets?month=YYYY-MM (default: current month). */
export const budgetQuerySchema = z.object({
  month: monthSchema.optional(),
});
export type BudgetQuery = z.infer<typeof budgetQuerySchema>;
