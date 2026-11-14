import { Router } from 'express';
import { getPlan, setSalary, updateRegularEntry } from '../controllers/plan.controller';
import {
  createRegularItem,
  deleteRegularItem,
  listRegularItems,
  updateRegularItem,
} from '../controllers/regular-item.controller';
import {
  createExtraIncome,
  createWithdrawal,
  deleteExtraIncome,
  deleteWithdrawal,
  getSavingsSummary,
} from '../controllers/savings.controller';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate';
import {
  extraIncomeBodySchema,
  planQuerySchema,
  regularEntryBodySchema,
  regularItemBodySchema,
  salaryBodySchema,
  withdrawalBodySchema,
} from '../validators/plan.schema';

/** /api/plan — monthly plan (R17–R19, design §12.4). Every member, no owner guard (R17 AC2, R18 AC5). */
export const planRouter = Router();

planRouter.get('/', validate(planQuerySchema, 'query'), asyncHandler(getPlan));
planRouter.put(
  '/salaries/:userId',
  validate(planQuerySchema, 'query'),
  validate(salaryBodySchema),
  asyncHandler(setSalary),
);
planRouter.put('/regular-entries/:id', validate(regularEntryBodySchema), asyncHandler(updateRegularEntry));

/** /api/regular-items — templates (R18). */
export const regularItemRouter = Router();

regularItemRouter.get('/', asyncHandler(listRegularItems));
regularItemRouter.post('/', validate(regularItemBodySchema), asyncHandler(createRegularItem));
regularItemRouter.put('/:id', validate(regularItemBodySchema), asyncHandler(updateRegularItem));
regularItemRouter.delete('/:id', asyncHandler(deleteRegularItem));

/** /api/savings — savings tracker, withdrawals (R19 AC4–AC6) & extra income (R20). */
export const savingsRouter = Router();

savingsRouter.get('/', asyncHandler(getSavingsSummary));
savingsRouter.post('/withdrawals', validate(withdrawalBodySchema), asyncHandler(createWithdrawal));
savingsRouter.delete('/withdrawals/:id', asyncHandler(deleteWithdrawal));
savingsRouter.post('/extra-income', validate(extraIncomeBodySchema), asyncHandler(createExtraIncome));
savingsRouter.delete('/extra-income/:id', asyncHandler(deleteExtraIncome));
