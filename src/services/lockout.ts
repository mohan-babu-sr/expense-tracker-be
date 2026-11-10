import type { Model, Types } from 'mongoose';
import { HttpError } from '../middleware/error-handler';
import type { Lockable } from '../models/user.model';
import { DUMMY_HASH, compareSecret } from './secret';

/** R13 AC3: 5 wrong PINs → locked for 15 minutes. Same rule for the admin password. */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

/** Any model with the Lockable fields (User, Admin). `any` keeps Mongoose's generics out of the way. */
type LockableModel = Model<any>;
type LockableAccount = Lockable & { _id: Types.ObjectId };

function lockedError(until: Date): HttpError {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return new HttpError(423, `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, undefined, {
    lockedUntil: until.toISOString(),
  });
}

/**
 * Checks a PIN / password with lockout (design §8.1). Throws:
 * - 423 if the account is locked (before even comparing — so guessing stops completely),
 * - `wrongError()` if the account doesn't exist or the secret is wrong (counts a failed attempt),
 * - 423 when this failure reaches the limit.
 * On success, resets the counter.
 */
export async function verifySecretWithLockout(
  model: LockableModel,
  account: LockableAccount | null,
  plain: string,
  hash: string | undefined,
  wrongError: () => HttpError,
): Promise<void> {
  if (account?.lockedUntil && account.lockedUntil > new Date()) throw lockedError(account.lockedUntil);

  const ok = await compareSecret(plain, hash ?? DUMMY_HASH);
  if (!account || !ok) {
    if (account) {
      // $inc is atomic, so parallel wrong attempts can't "lose" a count.
      const updated = await model
        .findByIdAndUpdate(account._id, { $inc: { failedAttempts: 1 } }, { returnDocument: 'after' })
        .lean<Lockable>();
      if (updated && updated.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        const until = new Date(Date.now() + LOCK_MINUTES * 60_000);
        await model.updateOne({ _id: account._id }, { $set: { failedAttempts: 0, lockedUntil: until } });
        throw lockedError(until);
      }
    }
    throw wrongError();
  }

  if (account.failedAttempts > 0 || account.lockedUntil) {
    await model.updateOne({ _id: account._id }, { $set: { failedAttempts: 0, lockedUntil: null } });
  }
}
