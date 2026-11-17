import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  adminLogin,
  changePin,
  login,
  logout,
  logoutAll,
  me,
  register,
  updateMe,
  verifyPin,
} from '../controllers/auth.controller';
import {
  deletePasskey,
  listPasskeys,
  verifyPasskey,
  verifyPasskeyOptions,
} from '../controllers/webauthn.controller';
import { asyncHandler } from '../middleware/async-handler';
import { requireAuth, requireUser } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  adminLoginSchema,
  changePinSchema,
  loginSchema,
  registerSchema,
  updateMeSchema,
  verifyPinSchema,
} from '../validators/auth.schema';
import { authenticationVerifySchema, emptySchema } from '../validators/webauthn.schema';

/**
 * Per-IP limit on sign-in / register (design §8.1): 20 FAILED requests per 15 minutes.
 * Successful requests don't count, so normal use never hits it. Together with the per-account
 * lockout this makes guessing a 4–6 digit PIN impractical.
 * Note: through the Vercel rewrite all browsers reach Render from Vercel's servers, so the "IP" is often
 * shared — fine for a household app; the per-account lockout is the main protection.
 */
export const signInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please wait 15 minutes and try again.' },
});

export const authRouter = Router();

authRouter.post('/register', signInLimiter, validate(registerSchema), asyncHandler(register));
authRouter.post('/login', signInLimiter, validate(loginSchema), asyncHandler(login));
authRouter.post('/admin/login', signInLimiter, validate(adminLoginSchema), asyncHandler(adminLogin));
authRouter.post('/logout', logout);
// R13 AC1a: needs a valid session (it changes the account). Pending users and the admin may use it too.
authRouter.post('/logout-all', requireAuth, asyncHandler(logoutAll));
authRouter.get('/me', requireAuth, asyncHandler(me));

/** /api/me — the signed-in user's own account (R13 AC4). */
export const meRouter = Router();

meRouter.use(requireAuth, requireUser);
meRouter.put('/', validate(updateMeSchema), asyncHandler(updateMe));
meRouter.put('/pin', validate(changePinSchema), asyncHandler(changePin));
meRouter.post('/verify-pin', validate(verifyPinSchema), asyncHandler(verifyPin));
// Fingerprint / Face ID devices and the salary unlock (R26 AC3–AC4, R27 — design §15.3).
meRouter.get('/passkeys', asyncHandler(listPasskeys));
meRouter.delete('/passkeys/:id', asyncHandler(deletePasskey));
meRouter.post('/verify-passkey/options', validate(emptySchema), asyncHandler(verifyPasskeyOptions));
meRouter.post('/verify-passkey', validate(authenticationVerifySchema), asyncHandler(verifyPasskey));
