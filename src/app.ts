import cookieParser from 'cookie-parser';
import express from 'express';
import morgan from 'morgan';
import { errorHandler } from './middleware/error-handler';
import { notFound } from './middleware/not-found';
import { apiRouter } from './routes';

/**
 * Builds the Express app (no `listen` here), so index.ts controls start-up order:
 * env → DB → seed → listen.
 */
export function createApp(): express.Express {
  const app = express();

  // No CORS (design §8.1): the browser only ever calls its own origin — Vercel rewrites /api to Render in
  // production, proxy.conf.json does it in dev. Without CORS headers, other websites' scripts can't read the API.
  // (REST clients like the VS Code extension aren't browsers, so they still work.)

  // Render sits behind one load balancer; trusting 1 hop lets Express read X-Forwarded-Proto/-For from it.
  app.set('trust proxy', 1);

  app.use(express.json());
  app.use(cookieParser()); // fills req.cookies — the session cookie (design §8.1)
  // Skip the health check: the keep-awake pinger (design §8.5, T40) calls it every 10 min and would bury the
  // real requests in Render's logs.
  app.use(morgan('dev', { skip: (req) => req.originalUrl === '/api/health' }));

  app.use('/api', apiRouter);

  app.use(notFound); // must come after all routes
  app.use(errorHandler); // must be last

  return app;
}
