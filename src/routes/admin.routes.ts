import { Router } from 'express';
import {
  adminCreateGroup,
  adminCreateUser,
  adminUpdateUser,
  approveUser,
  changeAdminPassword,
  disableUser,
  enableUser,
  listGroups,
  listUsers,
  rejectUser,
  resetUserPin,
} from '../controllers/admin.controller';
import { asyncHandler } from '../middleware/async-handler';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  changeAdminPasswordSchema,
  createGroupSchema,
  createUserSchema,
  listUsersQuerySchema,
  resetPinSchema,
  updateUserSchema,
} from '../validators/admin.schema';

/** /api/admin — design §8.3, R13 AC5–AC6. */
export const adminRouter = Router();

adminRouter.use(requireAuth);

// The ONE thing an admin with the initial password may do (R13 AC5). Registered before the general guard.
adminRouter.put(
  '/password',
  requireAdmin({ allowMustChange: true }),
  validate(changeAdminPasswordSchema),
  asyncHandler(changeAdminPassword),
);

// Everything else: admin who has already changed the initial password.
adminRouter.use(requireAdmin());

adminRouter.get('/groups', asyncHandler(listGroups));
adminRouter.post('/groups', validate(createGroupSchema), asyncHandler(adminCreateGroup));

adminRouter.get('/users', validate(listUsersQuerySchema, 'query'), asyncHandler(listUsers));
adminRouter.post('/users', validate(createUserSchema), asyncHandler(adminCreateUser));
adminRouter.put('/users/:id', validate(updateUserSchema), asyncHandler(adminUpdateUser));
adminRouter.post('/users/:id/reset-pin', validate(resetPinSchema), asyncHandler(resetUserPin));
adminRouter.post('/users/:id/approve', asyncHandler(approveUser));
adminRouter.post('/users/:id/reject', asyncHandler(rejectUser));
adminRouter.post('/users/:id/disable', asyncHandler(disableUser));
adminRouter.post('/users/:id/enable', asyncHandler(enableUser));
