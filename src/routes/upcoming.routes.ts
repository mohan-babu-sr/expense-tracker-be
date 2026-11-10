import { Router } from 'express';
import {
  createUpcoming,
  deleteUpcoming,
  listUpcoming,
  markUpcomingDone,
  restoreUpcoming,
  updateUpcoming,
} from '../controllers/upcoming.controller';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate';
import { upcomingBodySchema, upcomingQuerySchema } from '../validators/upcoming.schema';

/** /api/upcoming — R14, design §9.2. Any active member may add / edit (like expenses). */
export const upcomingRouter = Router();

upcomingRouter.get('/', validate(upcomingQuerySchema, 'query'), asyncHandler(listUpcoming));
upcomingRouter.post('/', validate(upcomingBodySchema), asyncHandler(createUpcoming));
upcomingRouter.put('/:id', validate(upcomingBodySchema), asyncHandler(updateUpcoming));
upcomingRouter.delete('/:id', asyncHandler(deleteUpcoming));
upcomingRouter.post('/:id/restore', asyncHandler(restoreUpcoming));
upcomingRouter.post('/:id/done', asyncHandler(markUpcomingDone));
