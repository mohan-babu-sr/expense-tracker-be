import { z } from 'zod';
import { GROUP_CODE_PATTERN } from '../models/group.model';
import { MOBILE_PATTERN } from '../models/user.model';

/**
 * Accepts the ways people type a number — "98765 43210", "+91 98765-43210", "098765…" — and keeps the
 * 10 digits, so the same phone can't register twice in different formats.
 */
export const normalizeMobile = (value: string): string =>
  value.replace(/[\s()-]/g, '').replace(/^(?:\+?91|0)(?=\d{10}$)/, '');

export const mobile = z
  .string({ error: 'Mobile number is required' })
  .transform(normalizeMobile)
  .pipe(z.string().regex(MOBILE_PATTERN, 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9'));

/** New PINs (R13 AC2). */
export const newPin = z.string({ error: 'PIN is required' }).regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits');

/** Entered PINs / passwords are only length-checked: a wrong format should get the same generic answer. */
export const enteredSecret = z.string({ error: 'Required' }).min(1, 'Required').max(72); // bcrypt uses max 72 bytes

export const personName = z.string().trim().min(1, 'Name is required').max(40, 'Name must be at most 40 characters');
export const groupName = z.string().trim().min(1, 'Group name is required').max(40, 'Group name must be at most 40 characters');
export const groupCode = z
  .string({ error: 'Group code is required' })
  .trim()
  .regex(GROUP_CODE_PATTERN, 'Code must be 6–20 letters, digits or "-"');

/** POST /auth/register (R13 AC2). */
export const registerSchema = z.object({
  name: personName,
  mobile,
  pin: newPin,
  group: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('create'), name: groupName, code: groupCode }),
    z.object({ mode: z.literal('join'), code: groupCode }),
  ]),
});
export type RegisterBody = z.infer<typeof registerSchema>;

/** POST /auth/login (R13 AC3). */
export const loginSchema = z.object({ mobile, pin: enteredSecret });
export type LoginBody = z.infer<typeof loginSchema>;

/** POST /auth/admin/login (R13 AC5). */
export const adminLoginSchema = z.object({
  username: z.string({ error: 'Username is required' }).trim().toLowerCase().min(1, 'Username is required').max(50),
  password: enteredSecret,
});
export type AdminLoginBody = z.infer<typeof adminLoginSchema>;

/**
 * PUT /me — strictObject: sending `mobile` or `groupId` is a 400, not silently ignored,
 * because users may not change them (R13 AC4).
 */
export const updateMeSchema = z.strictObject({ name: personName });
export type UpdateMeBody = z.infer<typeof updateMeSchema>;

/** PUT /me/pin (R13 AC4). */
export const changePinSchema = z.strictObject({ currentPin: enteredSecret, newPin });
export type ChangePinBody = z.infer<typeof changePinSchema>;
