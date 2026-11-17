import { Router } from 'express';
import {
  loginOptions,
  loginVerify,
  registerOptions,
  registerVerify,
} from '../controllers/webauthn.controller';
import { asyncHandler } from '../middleware/async-handler';
import { requireAuth, requireUser } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  authenticationVerifySchema,
  emptySchema,
  registerOptionsSchema,
  registerVerifySchema,
} from '../validators/webauthn.schema';
import { signInLimiter } from './auth.routes';

/**
 * /api/webauthn — passkey set up and sign-in (R26, design §15.3).
 * The salary unlock and the device list live under /api/me (auth.routes.ts).
 */
export const webauthnRouter = Router();

// Sign-in: public, rate-limited like PIN sign-in (failed requests count).
webauthnRouter.post('/login/options', signInLimiter, validate(emptySchema), asyncHandler(loginOptions));
webauthnRouter.post('/login/verify', signInLimiter, validate(authenticationVerifySchema), asyncHandler(loginVerify));

// Set up: a signed-in user (pending users too — like Change PIN).
webauthnRouter.post(
  '/register/options',
  requireAuth,
  requireUser,
  validate(registerOptionsSchema),
  asyncHandler(registerOptions),
);
webauthnRouter.post(
  '/register/verify',
  requireAuth,
  requireUser,
  validate(registerVerifySchema),
  asyncHandler(registerVerify),
);
