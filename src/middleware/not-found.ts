import type { Request, Response } from 'express';

/** Catch-all for routes that matched nothing. Registered after all routers. */
export function notFound(req: Request, res: Response): void {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}
