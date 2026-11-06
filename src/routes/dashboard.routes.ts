import { Router } from 'express';
import { getDashboard } from '../controllers/dashboard.controller';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate';
import { dashboardQuerySchema } from '../validators/dashboard.schema';

export const dashboardRouter = Router();

dashboardRouter.get('/', validate(dashboardQuerySchema, 'query'), asyncHandler(getDashboard));
