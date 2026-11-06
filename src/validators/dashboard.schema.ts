import { z } from 'zod';
import { monthSchema } from './common.schema';

/** GET /dashboard?month=YYYY-MM (default: current month) — R7 AC5. */
export const dashboardQuerySchema = z.object({
  month: monthSchema.optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
