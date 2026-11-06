import type { NextFunction, Request, Response } from 'express';

/**
 * An error that carries an HTTP status (e.g. 404, 409) and optional field errors.
 * Throw it from controllers/services; the error handler turns it into JSON.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors?: Record<string, string>,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Central error handler — design §2 "Validation & errors".
 * Response shape: `{ message, errors?: { field: msg } }`.
 * Unexpected errors are logged and hidden behind a generic 500 message.
 * Express recognises error middleware by its 4 parameters, so `_next` must stay.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message, errors: err.errors, ...err.extra });
    return;
  }

  // Malformed JSON body (thrown by express.json()).
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ message: 'Invalid JSON in request body' });
    return;
  }

  // Mongoose: invalid ObjectId in a query, e.g. GET /expenses/abc
  if (err instanceof Error && err.name === 'CastError') {
    res.status(400).json({ message: 'Invalid id' });
    return;
  }

  // MongoDB unique-index violation (e.g. two requests creating the same category at once).
  if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000) {
    res.status(409).json({ message: 'This item already exists' });
    return;
  }

  console.error(err);
  res.status(500).json({ message: 'Something went wrong. Please try again.' });
}
