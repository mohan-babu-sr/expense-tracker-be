import { HydratedDocument, Schema, Types, model } from 'mongoose';
import { toJsonOptionsWithout } from './to-json';

export const USER_ROLES = ['owner', 'member'] as const;
export const USER_STATUSES = ['pending', 'active', 'disabled'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];

/** Indian mobile number, 10 digits starting 6–9 (R13 AC2). Shared with the zod schemas. */
export const MOBILE_PATTERN = /^[6-9]\d{9}$/;

/** Fields used by the sign-in lockout (services/lockout.ts) — shared with Admin. */
export interface Lockable {
  failedAttempts: number;
  lockedUntil: Date | null;
  /** Bumped to invalidate every existing session of this account (design §8.1). */
  tokenVersion: number;
}

/** A person who signs in with mobile + PIN — design §8.2 (R13). One group per user. */
export interface IUser extends Lockable {
  name: string;
  mobile: string;
  /** bcrypt hash of the PIN — the PIN itself is never stored (NFR4). */
  pinHash: string;
  groupId: Types.ObjectId;
  role: UserRole;
  status: UserStatus;
}

export type UserDoc = HydratedDocument<IUser>;

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    mobile: { type: String, required: true, unique: true, match: MOBILE_PATTERN },
    pinHash: { type: String, required: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    role: { type: String, enum: USER_ROLES, required: true, default: 'member' },
    status: { type: String, enum: USER_STATUSES, required: true, default: 'pending' },
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    tokenVersion: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: toJsonOptionsWithout('pinHash', 'failedAttempts', 'lockedUntil', 'tokenVersion'),
  },
);

userSchema.index({ groupId: 1, status: 1 }); // members / pending list of a group

export const User = model<IUser>('User', userSchema);
