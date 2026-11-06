import { Router } from 'express';
import { deleteBudget, listBudgets, upsertBudget } from '../controllers/budget.controller';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate';
import { budgetBodySchema, budgetQuerySchema } from '../validators/budget.schema';

export const budgetRouter = Router();

budgetRouter.get('/', validate(budgetQuerySchema, 'query'), asyncHandler(listBudgets));
budgetRouter.put('/', validate(budgetBodySchema), asyncHandler(upsertBudget));
budgetRouter.delete('/:id', asyncHandler(deleteBudget));
