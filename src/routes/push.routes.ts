import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env';
import { daily, publicKey } from '../controllers/push.controller';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate';
import { dailyQuerySchema } from '../validators/push.schema';

/** A few calls per minute is plenty for "Send test" and the daily cron call (design §16.3). */
export const pushLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a minute and try again.' },
});

/** /api/push — public: the VAPID public key; the daily run is protected by the cron key header instead of a session. */
export const pushRouter = Router();

pushRouter.get('/public-key', publicKey);
/** The daily run: 10 calls a minute (cron retries + a manual test run). Off on a dry-run test server only. */
const cronLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  skip: () => env.PUSH_DRY_RUN,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a minute and try again.' },
});

pushRouter.post('/daily', cronLimiter, validate(dailyQuerySchema, 'query'), asyncHandler(daily));
