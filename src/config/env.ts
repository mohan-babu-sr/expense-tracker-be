import 'dotenv/config'; // loads server/.env into process.env before anything reads it
import { z } from 'zod';

/** Database names allowed by MongoDB Atlas for our use: letters, digits, `_` and `-`. */
export const DB_NAME_PATTERN = /^[A-Za-z0-9_-]{1,38}$/;

/**
 * Validated environment variables (design §3, §8.1, NFR4).
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
  /**
   * Optional: overrides the database named in MONGODB_URI (Mongoose `dbName`).
   * Local dev sets `expense_tracker_dev` so the live data is never touched; Render leaves it unset.
   */
  MONGODB_DB_NAME: z
    .string()
    .trim()
    .regex(DB_NAME_PATTERN, 'MONGODB_DB_NAME may only contain letters, digits, _ and - (max 38)')
    .optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  /** Signs session cookies (R13). Long + random; a different value on Render than locally. */
  JWT_SECRET: z
    .string({ error: 'JWT_SECRET is missing — see .env.example for how to generate one' })
    .min(32, 'JWT_SECRET must be at least 32 characters'),
  /** Password of the auto-created admin account; must be changed on first sign-in (R13 AC5). */
  ADMIN_INITIAL_PASSWORD: z.string().min(1).default('admin'),
  /**
   * Passkeys (R26, design §15.4). RP ID = the domain the browser shows (the Vercel site — /api is proxied there),
   * ORIGINS = the full page origins allowed to use passkeys. Public config, not secrets.
   * Defaults suit `ng serve`; production must set both (checked below).
   */
  WEBAUTHN_RP_ID: z.string().trim().min(1).optional(),
  WEBAUTHN_ORIGINS: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((v) => v?.split(',').map((o) => o.trim()).filter(Boolean)),
  WEBAUTHN_RP_NAME: z.string().trim().min(1).default('Expense Tracker'),
  /**
   * Web Push (R28, design §16.4). VAPID key pair from `npx web-push generate-vapid-keys` — the PRIVATE key is a
   * secret (NFR4); dev and live use different pairs. SUBJECT is a URL (not an e-mail) so nothing personal is sent
   * to the push services. PUSH_CRON_KEY protects POST /api/push/daily (cron-job.org sends it as a header).
   * Production must set the keys + cron key (checked below); development without them → push disabled.
   */
  VAPID_PUBLIC_KEY: z.string().trim().regex(/^[A-Za-z0-9_-]{80,100}$/, 'VAPID_PUBLIC_KEY must be base64url').optional(),
  VAPID_PRIVATE_KEY: z.string().trim().regex(/^[A-Za-z0-9_-]{40,50}$/, 'VAPID_PRIVATE_KEY must be base64url').optional(),
  VAPID_SUBJECT: z
    .string()
    .trim()
    .refine((v) => v.startsWith('https://') || v.startsWith('mailto:'), 'VAPID_SUBJECT must be an https:// or mailto: URL')
    .default('https://expense-tracker-claude-fe.vercel.app'),
  PUSH_CRON_KEY: z.string().trim().min(32, 'PUSH_CRON_KEY must be at least 32 characters').optional(),
  /** Tests only: record notifications instead of sending them (design §16.8). */
  PUSH_DRY_RUN: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

const PUSH_KEYS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'PUSH_CRON_KEY'] as const;

const parsed = envSchema
  .superRefine((v, ctx) => {
    // Half-configured push is always a mistake (e.g. public key without its private key).
    if (!!v.VAPID_PUBLIC_KEY !== !!v.VAPID_PRIVATE_KEY) {
      ctx.addIssue({ code: 'custom', path: ['VAPID_PRIVATE_KEY'], message: 'set both VAPID keys or neither' });
    }
    if (v.NODE_ENV !== 'production') return;
    for (const key of ['WEBAUTHN_RP_ID', 'WEBAUTHN_ORIGINS'] as const) {
      if (!v[key]?.length) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production (design §15.4)` });
      }
    }
    for (const key of PUSH_KEYS) {
      if (!v[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production (design §16.4)` });
      }
    }
    if (v.PUSH_DRY_RUN) {
      ctx.addIssue({ code: 'custom', path: ['PUSH_DRY_RUN'], message: 'PUSH_DRY_RUN is for tests only' });
    }
  })
  .transform((v) => ({
    ...v,
    WEBAUTHN_RP_ID: v.WEBAUTHN_RP_ID ?? 'localhost',
    WEBAUTHN_ORIGINS: v.WEBAUTHN_ORIGINS?.length ? v.WEBAUTHN_ORIGINS : ['http://localhost:4200'],
    /** Push works only with a VAPID key pair (R28); without it the API answers 503 and Settings says so. */
    PUSH_ENABLED: !!(v.VAPID_PUBLIC_KEY && v.VAPID_PRIVATE_KEY),
  }))
  .safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
