import { z } from 'zod';
import { USER_STATUSES } from '../models/user.model';
import { enteredSecret, groupCode, groupName, mobile, newPin, personName } from './auth.schema';
import { objectIdSchema } from './common.schema';

/** PUT /admin/password (R13 AC5). bcrypt only uses the first 72 bytes, hence the max. */
export const changeAdminPasswordSchema = z
  .strictObject({
    currentPassword: enteredSecret,
    newPassword: z
      .string({ error: 'New password is required' })
      .min(8, 'Password must be at least 8 characters')
      .max(72, 'Password must be at most 72 characters'),
  })
  .refine((b) => b.newPassword !== b.currentPassword, {
    message: 'New password must be different from the current one',
    path: ['newPassword'],
  })
  .refine((b) => b.newPassword.toLowerCase() !== 'admin', {
    message: 'Choose a password other than "admin"',
    path: ['newPassword'],
  });
export type ChangeAdminPasswordBody = z.infer<typeof changeAdminPasswordSchema>;

/** POST /admin/groups (R13 AC6). */
export const createGroupSchema = z.strictObject({ name: groupName, code: groupCode });
export type CreateGroupBody = z.infer<typeof createGroupSchema>;

/** GET /admin/users?q=&groupId=&status= — q searches name or mobile. */
export const listUsersQuerySchema = z.object({
  q: z.string().trim().max(40).optional(),
  groupId: objectIdSchema.optional(),
  status: z.enum(USER_STATUSES).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/** POST /admin/users — admin-added users are active at once (R13 AC6). */
export const createUserSchema = z.strictObject({ name: personName, mobile, pin: newPin, groupId: objectIdSchema });
export type CreateUserBody = z.infer<typeof createUserSchema>;

/** PUT /admin/users/:id — only the admin can change mobile or group (R13 AC4, AC6). */
export const updateUserSchema = z
  .strictObject({ name: personName.optional(), mobile: mobile.optional(), groupId: objectIdSchema.optional() })
  .refine((b) => b.name !== undefined || b.mobile !== undefined || b.groupId !== undefined, {
    message: 'Nothing to change',
  });
export type UpdateUserBody = z.infer<typeof updateUserSchema>;

/** POST /admin/users/:id/reset-pin. */
export const resetPinSchema = z.strictObject({ pin: newPin });
export type ResetPinBody = z.infer<typeof resetPinSchema>;
