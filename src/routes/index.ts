import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireMember } from '../middleware/auth';
import { adminRouter } from './admin.routes';
import { authRouter, meRouter } from './auth.routes';
import { groupRouter } from './group.routes';
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

apiRouter.use('/auth', authRouter);
apiRouter.use('/me', meRouter);
apiRouter.use('/admin', adminRouter); // own guards inside (admin only, password change first)

/**
 * Everything below is group data (R13 AC8): signed in (401) AND an active member (403), and the
 * controllers scope every query with req.groupId. Applied here, once, so no route can forget it.
 */
const memberOnly = [requireAuth, requireMember];
apiRouter.use('/groups', memberOnly, groupRouter);
apiRouter.use('/categories', memberOnly, categoryRouter);
apiRouter.use('/expenses', memberOnly, expenseRouter);
apiRouter.use('/budgets', memberOnly, budgetRouter);
apiRouter.use('/dashboard', memberOnly, dashboardRouter);
