import { HydratedDocument, Schema, model } from 'mongoose';
import { toJsonOptionsWithout } from './to-json';
import type { Lockable } from './user.model';

/**
 * The admin account — design §8.2 (R13 AC5–AC6).
 * Separate collection from users on purpose: an admin has no group, so it can never pass `requireMember`
 * and therefore can never read any group's expenses.
 */
export interface IAdmin extends Lockable {
  username: string;
  passwordHash: string;
  /** True for the auto-created admin/admin until the password is changed (R13 AC5). */
  mustChangePassword: boolean;
}

export type AdminDoc = HydratedDocument<IAdmin>;

const adminSchema = new Schema<IAdmin>(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    mustChangePassword: { type: Boolean, default: false },
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    tokenVersion: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: toJsonOptionsWithout('passwordHash', 'failedAttempts', 'lockedUntil', 'tokenVersion'),
  },
);

export const Admin = model<IAdmin>('Admin', adminSchema);
