import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async route handler so a rejected promise is passed to `next(err)`
 * and reaches the central error handler.
 *
 * Note: Express 5 already does this for returned promises; we keep the wrapper so the
 * intent is explicit in controllers and the code stays portable to Express 4.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
