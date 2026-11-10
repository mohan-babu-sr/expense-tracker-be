import type { Request, Response } from 'express';
import { groupIdOf } from '../middleware/auth';
import { HttpError } from '../middleware/error-handler';
import { Group } from '../models/group.model';
import { User } from '../models/user.model';

/**
 * GET /api/groups/current — the caller's group with its members and pending join requests
 * (R13 AC7, design §8.3). Members are what the expense form's "Spent by" select lists (T29).
 */
export async function getCurrentGroup(req: Request, res: Response): Promise<void> {
  const groupId = groupIdOf(req);
  const [group, users] = await Promise.all([
    Group.findById(groupId),
    User.find({ groupId, status: { $in: ['active', 'pending'] } }).sort({ name: 1 }),
  ]);
  if (!group) throw new HttpError(404, 'Group not found');

  // Only what members need to see about each other.
  const summary = (u: (typeof users)[number]) => ({ id: u.id as string, name: u.name, mobile: u.mobile, role: u.role });
  res.json({
    id: group.id as string,
    name: group.name,
    code: group.code,
    members: users.filter((u) => u.status === 'active').map(summary),
    pending: users.filter((u) => u.status === 'pending').map(summary),
  });
}

/** Pending user of THIS group, or 404 (another group's ids look non-existent — R13 AC8). */
async function findPendingOr404(req: Request) {
  const user = await User.findOne({ _id: req.params.userId as string, groupId: groupIdOf(req), status: 'pending' });
  if (!user) throw new HttpError(404, 'Join request not found');
  return user;
}

/** POST /api/groups/current/pending/:userId/approve — any active member may approve (R13 AC2, AC7). */
export async function approvePending(req: Request, res: Response): Promise<void> {
  const user = await findPendingOr404(req);
  user.status = 'active';
  await user.save();
  res.status(204).end();
}

/** POST /api/groups/current/pending/:userId/reject — removes the pending account (R13 AC2). */
export async function rejectPending(req: Request, res: Response): Promise<void> {
  const user = await findPendingOr404(req);
  await user.deleteOne(); // its session stops working: requireAuth can't find the account any more
  res.status(204).end();
}
