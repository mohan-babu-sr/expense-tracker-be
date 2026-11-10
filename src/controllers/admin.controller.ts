import type { Request, Response } from 'express';
import { Types, type QueryFilter } from 'mongoose';
import { HttpError } from '../middleware/error-handler';
import { Admin } from '../models/admin.model';
import { Group } from '../models/group.model';
import { User, type IUser, type UserDoc } from '../models/user.model';
import { escapeRegex } from '../services/filter-builder';
import { createGroup } from '../services/group.service';
import { verifySecretWithLockout } from '../services/lockout';
import { hashSecret } from '../services/secret';
import { setSessionCookie } from '../services/session';
import type {
  ChangeAdminPasswordBody,
  CreateGroupBody,
  CreateUserBody,
  ListUsersQuery,
  ResetPinBody,
  UpdateUserBody,
} from '../validators/admin.schema';

/*
 * Admin panel API — R13 AC5–AC6, design §8.3. Accounts and groups only: nothing here reads expenses,
 * categories or budgets, and the admin can't pass requireMember (R13 AC6).
 *
 * Every change that should sign a user out (PIN reset, disable, new mobile or group) bumps the user's
 * tokenVersion — requireAuth then rejects their existing sessions on the very next request.
 */

const mobileTaken = () =>
  new HttpError(409, 'This number is already registered', { mobile: 'This number is already registered' });

async function findUserOr404(req: Request): Promise<UserDoc> {
  const user = await User.findById(req.params.id as string);
  if (!user) throw new HttpError(404, 'User not found');
  return user;
}

async function findGroupOr400(groupId: string) {
  const group = await Group.findById(groupId);
  if (!group) throw new HttpError(400, 'Validation failed', { groupId: 'Group not found' });
  return group;
}

/** A group's first person becomes its owner (admin-created groups start empty). */
async function roleForNewMember(groupId: Types.ObjectId, exceptUserId?: Types.ObjectId) {
  const others = await User.exists({ groupId, ...(exceptUserId && { _id: { $ne: exceptUserId } }) });
  return others ? 'member' : 'owner';
}

/** User row for the admin list: the user (no secrets — toJSON) + its group's name/code. */
async function withGroups(users: UserDoc[]) {
  const groups = await Group.find({ _id: { $in: users.map((u) => u.groupId) } });
  const byId = new Map(groups.map((g) => [g.id as string, { id: g.id as string, name: g.name, code: g.code }]));
  return users.map((u) => ({ ...u.toJSON(), group: byId.get(u.groupId.toString()) ?? null }));
}

/** Saves, turning a duplicate-mobile race into a clean 409. */
async function saveUser(user: UserDoc): Promise<void> {
  try {
    await user.save();
  } catch (err) {
    if ((err as { code?: unknown }).code === 11000) throw mobileTaken();
    throw err;
  }
}

// ---------- password ----------

/**
 * PUT /api/admin/password — the only admin call allowed while mustChangePassword is true (R13 AC5).
 * Wrong current password → 400 field error (counts toward the lockout). Signs out other admin sessions.
 */
export async function changeAdminPassword(req: Request, res: Response): Promise<void> {
  const admin = req.admin!;
  const { currentPassword, newPassword } = req.body as ChangeAdminPasswordBody;

  await verifySecretWithLockout(Admin, admin, currentPassword, admin.passwordHash, () => {
    return new HttpError(400, 'Current password is incorrect', { currentPassword: 'Current password is incorrect' });
  });

  admin.passwordHash = await hashSecret(newPassword);
  admin.mustChangePassword = false;
  admin.tokenVersion += 1;
  await admin.save();

  setSessionCookie(res, { sub: admin.id as string, kind: 'admin', ver: admin.tokenVersion });
  res.status(204).end();
}

// ---------- groups ----------

/** GET /api/admin/groups — name, code, member + pending counts; newest first. */
export async function listGroups(_req: Request, res: Response): Promise<void> {
  const [groups, counts] = await Promise.all([
    Group.find().sort({ createdAt: -1 }),
    User.aggregate<{ _id: { groupId: Types.ObjectId; status: string }; n: number }>([
      { $group: { _id: { groupId: '$groupId', status: '$status' }, n: { $sum: 1 } } },
    ]),
  ]);
  const count = (groupId: string, status: string) =>
    counts.find((c) => c._id.groupId.toString() === groupId && c._id.status === status)?.n ?? 0;

  res.json(
    groups.map((g) => ({
      ...g.toJSON(),
      memberCount: count(g.id as string, 'active'),
      pendingCount: count(g.id as string, 'pending'),
    })),
  );
}

/** POST /api/admin/groups → 201 (with default categories, via createGroup — R13 AC10). */
export async function adminCreateGroup(req: Request, res: Response): Promise<void> {
  const { name, code } = req.body as CreateGroupBody;
  const group = await createGroup({ name, code, createdBy: null });
  res.status(201).json({ ...group.toJSON(), memberCount: 0, pendingCount: 0 });
}

// ---------- users ----------

/** GET /api/admin/users?q=&groupId=&status= — sorted by name. */
export async function listUsers(req: Request, res: Response): Promise<void> {
  const { q, groupId, status } = req.query as ListUsersQuery;
  const filter: QueryFilter<IUser> = {};
  if (groupId) filter.groupId = new Types.ObjectId(groupId);
  if (status) filter.status = status;
  if (q) {
    const regex = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: regex }, { mobile: regex }];
  }
  const users = await User.find(filter).sort({ name: 1 });
  res.json(await withGroups(users));
}

/** POST /api/admin/users → 201, active immediately (R13 AC6). */
export async function adminCreateUser(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateUserBody;
  const group = await findGroupOr400(body.groupId);
  if (await User.exists({ mobile: body.mobile })) throw mobileTaken();

  const user = new User({
    name: body.name,
    mobile: body.mobile,
    pinHash: await hashSecret(body.pin),
    groupId: group._id,
    role: await roleForNewMember(group._id),
    status: 'active',
  });
  await saveUser(user);
  res.status(201).json((await withGroups([user]))[0]);
}

/**
 * PUT /api/admin/users/:id — name, mobile, group (R13 AC6). A new mobile or group signs the user out.
 * Moving groups: their past expenses stay with the old group (R13 AC8); they join the new one as a member
 * (owner if it's empty) and keep their status.
 */
export async function adminUpdateUser(req: Request, res: Response): Promise<void> {
  const user = await findUserOr404(req);
  const body = req.body as UpdateUserBody;
  let signOut = false;

  if (body.name !== undefined) user.name = body.name;

  if (body.mobile !== undefined && body.mobile !== user.mobile) {
    if (await User.exists({ mobile: body.mobile, _id: { $ne: user._id } })) throw mobileTaken();
    user.mobile = body.mobile;
    signOut = true;
  }

  if (body.groupId !== undefined && body.groupId !== user.groupId.toString()) {
    const group = await findGroupOr400(body.groupId);
    user.groupId = group._id;
    user.role = await roleForNewMember(group._id, user._id);
    user.monthlyLimit = null; // set by the old group's owner (R15 AC7)
    signOut = true;
  }

  if (signOut) user.tokenVersion += 1;
  await saveUser(user);
  res.json((await withGroups([user]))[0]);
}

/** POST /api/admin/users/:id/reset-pin — "forgot PIN" (R13 AC4). Also unlocks and signs out. */
export async function resetUserPin(req: Request, res: Response): Promise<void> {
  const user = await findUserOr404(req);
  user.pinHash = await hashSecret((req.body as ResetPinBody).pin);
  user.failedAttempts = 0;
  user.lockedUntil = null;
  user.tokenVersion += 1;
  await user.save();
  res.status(204).end();
}

/** POST /api/admin/users/:id/approve — pending → active (same as a member approving, R13 AC2). */
export async function approveUser(req: Request, res: Response): Promise<void> {
  const user = await findUserOr404(req);
  if (user.status !== 'pending') throw new HttpError(409, 'Only pending users can be approved');
  user.status = 'active';
  await user.save();
  res.status(204).end();
}

/** POST /api/admin/users/:id/reject — removes a pending account (R13 AC2). */
export async function rejectUser(req: Request, res: Response): Promise<void> {
  const user = await findUserOr404(req);
  if (user.status !== 'pending') throw new HttpError(409, 'Only pending users can be rejected');
  await user.deleteOne();
  res.status(204).end();
}

/** POST /api/admin/users/:id/disable — can't sign in, existing sessions end (R13 AC6). */
export async function disableUser(req: Request, res: Response): Promise<void> {
  const user = await findUserOr404(req);
  if (user.status !== 'disabled') {
    user.status = 'disabled';
    user.tokenVersion += 1;
    await user.save();
  }
  res.status(204).end();
}

/** POST /api/admin/users/:id/enable — disabled → active. */
export async function enableUser(req: Request, res: Response): Promise<void> {
  const user = await findUserOr404(req);
  if (user.status !== 'disabled') throw new HttpError(409, 'Only disabled users can be enabled');
  user.status = 'active';
  await user.save();
  res.status(204).end();
}
