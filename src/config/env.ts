import 'dotenv/config'; // loads server/.env into process.env before anything reads it
import { z } from 'zod';

/**
 * Validated environment variables (design §3, NFR4).
 * Fails fast at start-up with a clear message instead of a confusing error later.
 */
const envSchema = z.object({
  MONGODB_URI: z
    .string({ error: 'MONGODB_URI is missing — create server/.env (see .env.example)' })
    .trim()
    .min(1, 'MONGODB_URI is empty — paste your Atlas connection string into server/.env')
    .refine((v) => v.startsWith('mongodb://') || v.startsWith('mongodb+srv://'), {
      message: 'MONGODB_URI must start with mongodb:// or mongodb+srv://',
    }),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
