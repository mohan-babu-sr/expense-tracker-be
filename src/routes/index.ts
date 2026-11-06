import { Router } from 'express';
import mongoose from 'mongoose';
import { budgetRouter } from './budget.routes';
import { categoryRouter } from './category.routes';
import { dashboardRouter } from './dashboard.routes';
import { expenseRouter } from './expense.routes';

export const apiRouter = Router();

/**
 * GET /api/health — dev check.
 * `db` comes from mongoose's readyState (1 = connected).
 */
apiRouter.get('/health', (_req, res) => {
  const db = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.json({ status: 'ok', db });
});

apiRouter.use('/categories', categoryRouter);
apiRouter.use('/expenses', expenseRouter);
apiRouter.use('/budgets', budgetRouter);
apiRouter.use('/dashboard', dashboardRouter);
