import type { Request, Response } from 'express';
import { Types, isValidObjectId } from 'mongoose';
import { HttpError } from '../middleware/error-handler';
import { Admin, type AdminDoc } from '../models/admin.model';
import { Group } from '../models/group.model';
import { Passkey } from '../models/passkey.model';
import { PushSubscription } from '../models/push-subscription.model';
import { removeSubscriptionsOf } from '../services/push';
import { logoutSchema } from '../validators/push.schema';
import { User, type UserDoc } from '../models/user.model';
import { createGroup, findGroupByCode, removeGroup, type GroupDoc } from '../services/group.service';
import { verifySecretWithLockout } from '../services/lockout';
import { hashSecret } from '../services/secret';
import { clearSessionCookie, readSession, setSessionCookie } from '../services/session';
import type {
  AdminLoginBody,
  ChangePinBody,
  LoginBody,
  RegisterBody,
  UpdateMeBody,
  VerifyPinBody,
} from '../validators/auth.schema';

/** `Me` — what the client needs after sign-in / on start-up (design §8.3 GET /auth/me). */
type Me =
  | {
      kind: 'user';
      user: ReturnType<UserDoc['toJSON']>;
      group: { id: string; name: string; code: string } | null;
      status: string;
      /** Registered fingerprint / Face ID devices (R26 AC6, R27 AC1). */
      passkeyCount: number;
    }
  | { kind: 'admin'; username: string; mustChangePassword: boolean };

export async function userMe(user: UserDoc, group: GroupDoc | null): Promise<Me> {
  return {
    kind: 'user',
    user: user.toJSON(), // toJSON removes pinHash & lockout fields (user.model.ts)
    group: group && { id: group.id as string, name: group.name, code: group.code },
    status: user.status,
    passkeyCount: await Passkey.countDocuments({ userId: user._id }),
  };
}

const adminMe = (admin: AdminDoc): Me => ({
  kind: 'admin',
  username: admin.username,
  mustChangePassword: admin.mustChangePassword,
});

export const startUserSession = (res: Response, user: UserDoc) =>
  setSessionCookie(res, { sub: user.id as string, kind: 'user', ver: user.tokenVersion });

/** One message for "unknown number" and "wrong PIN", so sign-in doesn't reveal who is registered (R13 AC3). */
const wrongMobileOrPin = () => new HttpError(401, 'Mobile number or PIN is incorrect');

/** POST /api/auth/register — R13 AC2. Create group → owner (active); join → member (pending). */
export async function register(req: Request, res: Response): Promise<void> {
  const body = req.body as RegisterBody;

  if (await User.exists({ mobile: body.mobile })) {
    throw new HttpError(409, 'This number is already registered', {
      mobile: 'This number is already registered',
    });
  }

  const isCreate = body.group.mode === 'create';
  // The user's id is generated up front so the new group can record who created it.
  const userId = new Types.ObjectId();
  let group: GroupDoc | null;
  if (body.group.mode === 'create') {
    group = await createGroup({ name: body.group.name, code: body.group.code, createdBy: userId });
  } else {
    group = await findGroupByCode(body.group.code);
    if (!group) throw new HttpError(404, 'No group with this code', { 'group.code': 'No group with this code' });
  }

  let user: UserDoc;
  try {
    user = await User.create({
      _id: userId,
      name: body.name,
      mobile: body.mobile,
      pinHash: await hashSecret(body.pin),
      groupId: group._id,
      role: isCreate ? 'owner' : 'member',
      status: isCreate ? 'active' : 'pending',
    });
  } catch (err) {
    if (isCreate) await removeGroup(group._id); // don't leave an empty group behind
    if ((err as { code?: unknown }).code === 11000) {
      // Same number registered at the same moment by another request.
      throw new HttpError(409, 'This number is already registered', { mobile: 'This number is already registered' });
    }
    throw err;
  }

  startUserSession(res, user);
  res.status(201).json(await userMe(user, group));
}

/** POST /api/auth/login — R13 AC3 (lockout after 5 wrong PINs). */
export async function login(req: Request, res: Response): Promise<void> {
  const { mobile, pin } = req.body as LoginBody;
  const user = await User.findOne({ mobile });

  await verifySecretWithLockout(User, user, pin, user?.pinHash, wrongMobileOrPin);
  // Only reached with the right PIN, so "disabled" is never revealed to someone guessing.
  if (!user || user.status === 'disabled') {
    throw new HttpError(403, 'This account is disabled. Please contact the admin.');
  }

  startUserSession(res, user);
  res.json(await userMe(user, await Group.findById(user.groupId)));
}

/** POST /api/auth/admin/login — R13 AC5. */
export async function adminLogin(req: Request, res: Response): Promise<void> {
  const { username, password } = req.body as AdminLoginBody;
  const admin = await Admin.findOne({ username });

  await verifySecretWithLockout(Admin, admin, password, admin?.passwordHash, () => {
    return new HttpError(401, 'Username or password is incorrect');
  });

  setSessionCookie(res, { sub: admin!.id as string, kind: 'admin', ver: admin!.tokenVersion });
  res.json(adminMe(admin!));
}

/**
 * POST /api/auth/logout — always succeeds, even without a session.
 * Optional `{ pushEndpoint }`: this device's notifications stop too, so a shared phone doesn't keep getting the
 * previous person's alerts (R28 AC7). Only removed when it belongs to the session's user.
 */
export async function logout(req: Request, res: Response): Promise<void> {
  const { pushEndpoint } = logoutSchema.parse(req.body ?? {});
  const session = readSession(req);
  if (pushEndpoint && session?.kind === 'user' && isValidObjectId(session.sub)) {
    await PushSubscription.deleteOne({ userId: session.sub, endpoint: pushEndpoint });
  }
  clearSessionCookie(res);
  res.status(204).end();
}

/**
 * POST /api/auth/logout-all — R13 AC1a (requireAuth already ran).
 * Plain logout can only delete THIS browser's cookie; a copy of the token elsewhere would stay valid until it
 * expires (30 days). Bumping tokenVersion makes requireAuth reject every token issued so far — all devices at once.
 * `$inc` is atomic, so it can't race with another request that saves the account.
 */
export async function logoutAll(req: Request, res: Response): Promise<void> {
  if (req.admin) {
    await Admin.updateOne({ _id: req.admin._id }, { $inc: { tokenVersion: 1 } });
  } else {
    await User.updateOne({ _id: req.user!._id }, { $inc: { tokenVersion: 1 } });
    await removeSubscriptionsOf(req.user!._id); // R28 AC7: no notifications on any device either
  }
  clearSessionCookie(res);
  res.status(204).end();
}

/** GET /api/auth/me — who is signed in (requireAuth already ran). */
export async function me(req: Request, res: Response): Promise<void> {
  if (req.admin) {
    res.json(adminMe(req.admin));
    return;
  }
  const user = req.user!;
  res.json(await userMe(user, await Group.findById(user.groupId)));
}

/** PUT /api/me — change own name. Mobile and group can't be changed here (R13 AC4). */
export async function updateMe(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  user.name = (req.body as UpdateMeBody).name;
  await user.save();
  res.json(await userMe(user, await Group.findById(user.groupId)));
}

/**
 * PUT /api/me/pin — R13 AC4. Wrong current PIN → 400 field error (not 401: the session itself is fine,
 * and 401 would sign the user out in the client). It still counts toward the lockout.
 * Success signs out every OTHER device (tokenVersion bump) and gives this device a fresh cookie.
 */
export async function changePin(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { currentPin, newPin } = req.body as ChangePinBody;

  await verifySecretWithLockout(User, user, currentPin, user.pinHash, () => {
    return new HttpError(400, 'Current PIN is incorrect', { currentPin: 'Current PIN is incorrect' });
  });

  user.pinHash = await hashSecret(newPin);
  user.tokenVersion += 1;
  user.failedAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  startUserSession(res, user);
  res.status(204).end();
}

/**
 * POST /api/me/verify-pin — R22 AC2 (design §14.1): "is this my PIN?" before Plan shows other members' salaries.
 * Changes nothing. Wrong PIN → 400 field error (not 401, which would sign the user out) and counts toward the
 * same lockout as sign-in, so this can't be used to guess the PIN faster.
 */
export async function verifyPin(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const { pin } = req.body as VerifyPinBody;
  await verifySecretWithLockout(User, user, pin, user.pinHash, () => {
    return new HttpError(400, 'PIN is incorrect', { pin: 'PIN is incorrect' });
  });
  res.status(204).end();
}
