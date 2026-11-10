import { Router } from 'express';
import { deleteBudget, listBudgets, setMemberLimit, upsertBudget } from '../controllers/budget.controller';
import { asyncHandler } from '../middleware/async-handler';
import { requireOwner } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { budgetBodySchema, budgetQuerySchema, memberLimitBodySchema } from '../validators/budget.schema';

export const budgetRouter = Router();

// Reading is for every member; every write is owner-only (R15 AC5).
budgetRouter.get('/', validate(budgetQuerySchema, 'query'), asyncHandler(listBudgets));
budgetRouter.put('/', requireOwner, validate(budgetBodySchema), asyncHandler(upsertBudget));
budgetRouter.put(
  '/members/:userId',
  requireOwner,
  validate(budgetQuerySchema, 'query'),
  validate(memberLimitBodySchema),
  asyncHandler(setMemberLimit),
);
budgetRouter.delete('/:id', requireOwner, asyncHandler(deleteBudget));
