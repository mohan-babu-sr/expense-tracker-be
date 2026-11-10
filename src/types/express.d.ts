import type { Types } from 'mongoose';
import type { AdminDoc } from '../models/admin.model';
import type { UserDoc } from '../models/user.model';

/** Fields the auth middleware adds to every request (middleware/auth.ts, design §8.3). */
declare global {
  namespace Express {
    interface Request {
      /** Signed-in user (set by requireAuth). */
      user?: UserDoc;
      /** Signed-in admin (set by requireAuth). */
      admin?: AdminDoc;
      /** The signed-in member's group (set by requireMember) — every data query is scoped to it (T25). */
      groupId?: Types.ObjectId;
    }
  }
}

export {};
