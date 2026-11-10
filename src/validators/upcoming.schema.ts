import { z } from 'zod';
import { REPEATS } from '../models/upcoming.model';
import { amountSchema, isoDateSchema, objectIdSchema, optionalTextSchema } from './common.schema';

/** POST / PUT /upcoming body — R14 AC1. Past due dates are allowed (they show as overdue). */
export const upcomingBodySchema = z.object({
  title: z.string({ error: 'Title is required' }).trim().min(1, 'Title is required').max(60, 'Title must be at most 60 characters'),
  categoryId: objectIdSchema,
  amount: amountSchema,
  dueDate: isoDateSchema,
  repeat: z.enum(REPEATS, { error: `Repeat must be one of ${REPEATS.join(', ')}` }).default('none'),
  note: optionalTextSchema(200, 'Note'),
});
export type UpcomingBody = z.infer<typeof upcomingBodySchema>;

/** GET /upcoming?status=open|done (default open). */
export const upcomingQuerySchema = z.object({
  status: z.enum(['open', 'done']).default('open'),
});
export type UpcomingQuery = z.infer<typeof upcomingQuerySchema>;
