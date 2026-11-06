import { Router } from 'express';
import {
  createExpense,
  deleteExpense,
  exportExpenses,
  getExpense,
  listExpenses,
  listMerchants,
  restoreExpense,
  updateExpense,
} from '../controllers/expense.controller';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate';
import {
  expenseBodySchema,
  expenseFilterSchema,
  expenseListQuerySchema,
  merchantQuerySchema,
} from '../validators/expense.schema';

export const expenseRouter = Router();

expenseRouter.get('/', validate(expenseListQuerySchema, 'query'), asyncHandler(listExpenses));
expenseRouter.post('/', validate(expenseBodySchema), asyncHandler(createExpense));

// Must be registered BEFORE '/:id' — otherwise Express matches "merchants" / "export" as an id.
expenseRouter.get('/merchants', validate(merchantQuerySchema, 'query'), asyncHandler(listMerchants));
expenseRouter.get('/export', validate(expenseFilterSchema, 'query'), asyncHandler(exportExpenses));

expenseRouter.get('/:id', asyncHandler(getExpense));
expenseRouter.put('/:id', validate(expenseBodySchema), asyncHandler(updateExpense));
expenseRouter.delete('/:id', asyncHandler(deleteExpense));
expenseRouter.post('/:id/restore', asyncHandler(restoreExpense));
