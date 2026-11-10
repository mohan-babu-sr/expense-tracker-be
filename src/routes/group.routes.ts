import { Router } from 'express';
import { approvePending, getCurrentGroup, rejectPending } from '../controllers/group.controller';
import { asyncHandler } from '../middleware/async-handler';

/** /api/groups — mounted behind requireAuth + requireMember in routes/index.ts. */
export const groupRouter = Router();

groupRouter.get('/current', asyncHandler(getCurrentGroup));
groupRouter.post('/current/pending/:userId/approve', asyncHandler(approvePending));
groupRouter.post('/current/pending/:userId/reject', asyncHandler(rejectPending));
