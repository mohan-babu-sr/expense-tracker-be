import cors from 'cors';
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

  app.use(cors()); // dev proxy makes this unnecessary for the Angular app, but handy for REST clients
  app.use(express.json());
  app.use(morgan('dev'));

  app.use('/api', apiRouter);

  app.use(notFound); // must come after all routes
  app.use(errorHandler); // must be last

  return app;
}
