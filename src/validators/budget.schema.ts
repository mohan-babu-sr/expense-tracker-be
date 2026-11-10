import { z } from 'zod';
import { amountSchema, monthSchema, objectIdSchema } from './common.schema';

/**
 * PUT /budgets body — a category budget (R8 AC1). v3: `categoryId` is required; the overall budget is
 * computed from the member limits (R15 AC3), so `null` is rejected.
 */
export const budgetBodySchema = z.object({
  categoryId: objectIdSchema,
  amount: amountSchema,
});
export type BudgetBody = z.infer<typeof budgetBodySchema>;

/** GET /budgets?month=YYYY-MM (default: current month). Also used by PUT /budgets/members/:userId. */
export const budgetQuerySchema = z.object({
  month: monthSchema.optional(),
});
export type BudgetQuery = z.infer<typeof budgetQuerySchema>;

/** PUT /budgets/members/:userId body — the member's monthly limit; null = no limit (R15 AC1). */
export const memberLimitBodySchema = z.object({
  limit: amountSchema.nullable(),
});
export type MemberLimitBody = z.infer<typeof memberLimitBodySchema>;
