import type { Request, RequestHandler } from 'express';
import { isValidObjectId, type Types } from 'mongoose';
import { Admin } from '../models/admin.model';
import { User } from '../models/user.model';
import { clearSessionCookie, readSession } from '../services/session';
import { asyncHandler } from './async-handler';
import { HttpError } from './error-handler';

/**
 * Auth middleware — design §8.3.
 *   requireAuth   → 401 unless a valid session; sets req.user or req.admin
 *   requireUser   → 403 unless a user (pending users allowed: they can see /auth/me and edit their name/PIN)
 *   requireAdmin  → 403 unless an admin who has already changed the initial password
 *   requireMember → 403 unless an ACTIVE user; sets req.groupId (used by all data routes from T25)
 */

const sessionEnded = () => new HttpError(401, 'Your session has ended. Please sign in again.');

export const requireAuth: RequestHandler = asyncHandler(async (req, res, next) => {
  const session = readSession(req);
  if (!session) throw new HttpError(401, 'Please sign in');
  if (!isValidObjectId(session.sub)) throw sessionEnded();

  if (session.kind === 'user') {
    const user = await User.findById(session.sub);
    // Deleted, signed out everywhere (PIN reset / moved / disabled bump tokenVersion), or disabled.
    if (!user || user.tokenVersion !== session.ver || user.status === 'disabled') {
      clearSessionCookie(res);
      throw sessionEnded();
    }
    req.user = user;
  } else {
    const admin = await Admin.findById(session.sub);
    if (!admin || admin.tokenVersion !== session.ver) {
      clearSessionCookie(res);
      throw sessionEnded();
    }
    req.admin = admin;
  }
  next();
});

export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(403, 'Only for user accounts');
  next();
};

/** `allowMustChange` is only for PUT /admin/password — the one thing the admin may do first (R13 AC5). */
export function requireAdmin(options: { allowMustChange?: boolean } = {}): RequestHandler {
  return (req, _res, next) => {
    if (!req.admin) throw new HttpError(403, 'Only for the admin');
    if (req.admin.mustChangePassword && !options.allowMustChange) {
      throw new HttpError(403, 'Please change the admin password first', undefined, { code: 'MUST_CHANGE_PASSWORD' });
    }
    next();
  };
}

/**
 * The signed-in member's group, for controllers behind requireMember. Throws (500) if a route forgot the
 * middleware — failing loudly is safer than running an unscoped query.
 */
export function groupIdOf(req: Request): Types.ObjectId {
  if (!req.groupId) throw new Error('groupIdOf() used on a route without requireMember');
  return req.groupId;
}

export const requireMember: RequestHandler = (req, _res, next) => {
  if (req.admin) {
    // R13 AC6: the admin manages accounts only and never sees group data.
    throw new HttpError(403, 'The admin account cannot open group data', undefined, { code: 'ADMIN' });
  }
  if (!req.user) throw new HttpError(401, 'Please sign in');
  if (req.user.status === 'pending') {
    throw new HttpError(403, 'Waiting for approval to join the group', undefined, { code: 'PENDING' });
  }
  req.groupId = req.user.groupId;
  next();
};

/**
 * R15 AC5 — only the group owner may change budgets and member limits. Use AFTER requireMember.
 * The role comes from the user document requireAuth loaded from the DB, never from the client;
 * hiding buttons in Angular is only UX, this 403 is the real rule.
 */
export const requireOwner: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'owner') {
    throw new HttpError(403, 'Only the group owner can change budgets', undefined, { code: 'NOT_OWNER' });
  }
  next();
};
