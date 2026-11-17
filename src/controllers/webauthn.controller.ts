import type { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { HttpError } from '../middleware/error-handler';
import { Group } from '../models/group.model';
import { MAX_PASSKEYS_PER_USER, Passkey } from '../models/passkey.model';
import { User } from '../models/user.model';
import { verifySecretWithLockout } from '../services/lockout';
import {
  authenticationOptions,
  registrationOptions,
  takeChallenge,
  userHandleMatches,
  verifyAuthentication,
  verifyRegistration,
} from '../services/webauthn';
import type {
  AuthenticationVerifyBody,
  RegisterOptionsBody,
  RegisterVerifyBody,
} from '../validators/webauthn.schema';
import { startUserSession, userMe } from './auth.controller';

/*
 * Fingerprint / Face ID with passkeys — R26–R27, design §15.3. The PIN stays: it's needed to add a device,
 * and every PIN endpoint is unchanged (R26 AC1).
 */

const tooMany = () => new HttpError(409, `You can add up to ${MAX_PASSKEYS_PER_USER} devices`);

// ---------- set up (R26 AC3) ----------

/** POST /api/webauthn/register/options { pin } — wrong PIN → 400 field error, counts toward the lockout. */
export async function registerOptions(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { pin } = req.body as RegisterOptionsBody;
  await verifySecretWithLockout(User, user, pin, user.pinHash, () => {
    return new HttpError(400, 'PIN is incorrect', { pin: 'PIN is incorrect' });
  });
  const existing = await Passkey.find({ userId: user._id });
  if (existing.length >= MAX_PASSKEYS_PER_USER) throw tooMany();
  res.json(await registrationOptions(res, user, existing));
}

/** POST /api/webauthn/register/verify { response, deviceName } → 201 { id, deviceName, createdAt, lastUsedAt } */
export async function registerVerify(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { response, deviceName } = req.body as RegisterVerifyBody;
  const challenge = await takeChallenge(req, res, 'register', user._id);
  const credential = await verifyRegistration(response, challenge);
  // Checked again: two set-ups could have been started side by side.
  if ((await Passkey.countDocuments({ userId: user._id })) >= MAX_PASSKEYS_PER_USER) throw tooMany();
  try {
    const passkey = await Passkey.create({ ...credential, userId: user._id, deviceName });
    res.status(201).json(passkey.toJSON());
  } catch (err) {
    if ((err as { code?: unknown }).code === 11000) {
      throw new HttpError(409, 'Fingerprint / Face ID is already set up on this device');
    }
    throw err;
  }
}

// ---------- my devices (R26 AC3–AC4) ----------

/** GET /api/me/passkeys — newest first. */
export async function listPasskeys(req: Request, res: Response): Promise<void> {
  const passkeys = await Passkey.find({ userId: req.user!._id }).sort({ createdAt: -1 });
  res.json(passkeys.map((p) => p.toJSON()));
}

/** DELETE /api/me/passkeys/:id — own devices only (anyone else's id → 404). */
export async function deletePasskey(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const removed = isValidObjectId(id) && (await Passkey.findOneAndDelete({ _id: id, userId: req.user!._id }));
  if (!removed) throw new HttpError(404, 'Device not found');
  res.status(204).end();
}

// ---------- sign in (R26 AC5, AC7) ----------

/** POST /api/webauthn/login/options — no mobile number: the device offers its passkey for this site. */
export async function loginOptions(_req: Request, res: Response): Promise<void> {
  res.json(await authenticationOptions(res, 'login', null));
}

/**
 * POST /api/webauthn/login/verify { response } → same body as PIN sign-in + session cookie.
 * The signature is checked BEFORE the account status is revealed (same order as the PIN path).
 */
export async function loginVerify(req: Request, res: Response): Promise<void> {
  const { response } = req.body as AuthenticationVerifyBody;
  const challenge = await takeChallenge(req, res, 'login', null);
  const failed = () => new HttpError(401, 'Fingerprint / Face ID sign-in failed. Please try again or use your PIN.');
  const removed = () =>
    new HttpError(404, 'This fingerprint / Face ID sign-in was removed — use your PIN', undefined, {
      code: 'PASSKEY_REMOVED',
    });

  const passkey = await Passkey.findOne({ credentialId: response.id });
  if (!passkey) throw removed();
  if (!userHandleMatches(response.response.userHandle, passkey.userId)) throw failed();
  const user = await User.findById(passkey.userId);
  if (!user) {
    await passkey.deleteOne(); // its account is gone
    throw removed();
  }
  if (!(await verifyAuthentication(passkey, response, challenge))) throw failed();

  if (user.status === 'disabled') throw new HttpError(403, 'This account is disabled. Please contact the admin.');
  // R26 AC7: a fingerprint can't be guessed, so it clears the wrong-PIN counter and lock.
  if (user.failedAttempts > 0 || user.lockedUntil) {
    user.failedAttempts = 0;
    user.lockedUntil = null;
    await user.save();
  }
  startUserSession(res, user);
  res.json(await userMe(user, await Group.findById(user.groupId)));
}

// ---------- unlock salaries (R27) ----------

const didntWork = () =>
  new HttpError(400, "Didn't work — try again or use your PIN", undefined, { code: 'PASSKEY_FAILED' });

/** POST /api/me/verify-passkey/options — only the signed-in user's own passkeys are allowed (R27 AC2). */
export async function verifyPasskeyOptions(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const passkeys = await Passkey.find({ userId: user._id });
  if (!passkeys.length) {
    throw new HttpError(404, 'No fingerprint / Face ID set up', undefined, { code: 'NO_PASSKEYS' });
  }
  res.json(await authenticationOptions(res, 'verify', user._id, passkeys));
}

/**
 * POST /api/me/verify-passkey { response } → 204. Changes nothing (like verify-pin). Failures are 400 and do NOT
 * count toward the PIN lockout — the device limits its own retries (R27 AC3).
 */
export async function verifyPasskey(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { response } = req.body as AuthenticationVerifyBody;
  const challenge = await takeChallenge(req, res, 'verify', user._id);
  // Another member's passkey on the same phone isn't in this user's list → refused (R27 AC2).
  const passkey = await Passkey.findOne({ credentialId: response.id, userId: user._id });
  if (!passkey || !(await verifyAuthentication(passkey, response, challenge))) throw didntWork();
  res.status(204).end();
}
