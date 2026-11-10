import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

/**
 * Session cookie (design §8.1, NFR4).
 * - httpOnly: JavaScript (including any injected script) can't read it.
 * - Secure in production: only sent over HTTPS (Vercel). Locally it's plain http://localhost.
 * - SameSite=Lax: not sent with cross-site POST/PUT/DELETE → basic CSRF protection.
 * - Path /api: only API calls carry it, not page/asset requests.
 */
const COOKIE_NAME = 'session';
const MAX_AGE_DAYS = 30;

export type SessionKind = 'user' | 'admin';

export interface SessionPayload {
  /** Account id (users or admins collection, depending on `kind`). */
  sub: string;
  kind: SessionKind;
  /** Account's tokenVersion when the session was created; a mismatch means "signed out everywhere". */
  ver: number;
}

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api',
};

export function setSessionCookie(res: Response, payload: SessionPayload): void {
  const token = jwt.sign(payload, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: `${MAX_AGE_DAYS}d` });
  res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: MAX_AGE_DAYS * 24 * 60 * 60 * 1000 });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, cookieOptions);
}

/** Returns the verified payload, or null when there's no cookie or it's invalid/expired/tampered. */
export function readSession(req: Request): SessionPayload | null {
  const token: unknown = req.cookies?.[COOKIE_NAME];
  if (typeof token !== 'string' || !token) return null;
  try {
    // Pin the algorithm so a token can't pick a weaker one (e.g. "none").
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || decoded === null) return null;
    const { sub, kind, ver } = decoded as Partial<SessionPayload>;
    if (typeof sub !== 'string' || (kind !== 'user' && kind !== 'admin') || typeof ver !== 'number') return null;
    return { sub, kind, ver };
  } catch {
    return null;
  }
}
