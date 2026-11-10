import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { HttpError } from '../middleware/error-handler';
import { Admin, type AdminDoc } from '../models/admin.model';
import { Group } from '../models/group.model';
import { User, type UserDoc } from '../models/user.model';
import { createGroup, findGroupByCode, removeGroup, type GroupDoc } from '../services/group.service';
import { verifySecretWithLockout } from '../services/lockout';
import { hashSecret } from '../services/secret';
import { clearSessionCookie, setSessionCookie } from '../services/session';
import type {
  AdminLoginBody,
  ChangePinBody,
  LoginBody,
  RegisterBody,
  UpdateMeBody,
} from '../validators/auth.schema';

/** `Me` — what the client needs after sign-in / on start-up (design §8.3 GET /auth/me). */
type Me =
  | {
      kind: 'user';
      user: ReturnType<UserDoc['toJSON']>;
      group: { id: string; name: string; code: string } | null;
      status: string;
    }
  | { kind: 'admin'; username: string; mustChangePassword: boolean };

function userMe(user: UserDoc, group: GroupDoc | null): Me {
  return {
    kind: 'user',
    user: user.toJSON(), // toJSON removes pinHash & lockout fields (user.model.ts)
    group: group && { id: group.id as string, name: group.name, code: group.code },
    status: user.status,
  };
}

const adminMe = (admin: AdminDoc): Me => ({
  kind: 'admin',
  username: admin.username,
  mustChangePassword: admin.mustChangePassword,
});

const startUserSession = (res: Response, user: UserDoc) =>
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
  res.status(201).json(userMe(user, group));
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
  res.json(userMe(user, await Group.findById(user.groupId)));
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

/** POST /api/auth/logout — always succeeds, even without a session. */
export function logout(_req: Request, res: Response): void {
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
  res.json(userMe(user, await Group.findById(user.groupId)));
}

/** PUT /api/me — change own name. Mobile and group can't be changed here (R13 AC4). */
export async function updateMe(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  user.name = (req.body as UpdateMeBody).name;
  await user.save();
  res.json(userMe(user, await Group.findById(user.groupId)));
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
