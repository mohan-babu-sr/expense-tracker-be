import { env } from './config/env'; // first import: loads & validates .env
import { connectDb } from './config/db';
import { createApp } from './app';
import { seedCategories } from './services/seed';

// Start-up order (design §3): env → connect DB → seed categories → listen.
async function main(): Promise<void> {
  await connectDb(env.MONGODB_URI, env.MONGODB_DB_NAME, env.NODE_ENV === 'production');
  await seedCategories();

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}/api`);
  });
}

main().catch((err: unknown) => {
  console.error('❌ Failed to start server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
