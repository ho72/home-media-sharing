import { z } from 'zod';

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  PUBLIC_ORIGIN: z.string().url(),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be ≥32 chars'),
  SESSION_COOKIE_NAME: z.string().default('photoapp_sid'),
  SESSION_COOKIE_DOMAIN: z.string().optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),

  DATABASE_URL: z.string(),
  DATA_DIR: z.string(),
  ORIGINALS_DIR: z.string(),
  THUMBS_DIR: z.string(),
  BACKUPS_DIR: z.string(),

  DEFAULT_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 ** 3),
  USER_STORAGE_QUOTA_BYTES: z.coerce.number().int().positive().default(15 * 1024 ** 3),

  UNIPASS_BASE_URL: z.string().url().default('http://localhost:4000'),
  UNIPASS_JWT_SECRET: z.string().min(32).optional(),

  BOOTSTRAP_ADMIN_UNIPASS_USER_ID: z.string().optional(),
  BOOTSTRAP_ADMIN_DISPLAY_NAME: z.string().optional(),
});

export const env = Schema.parse(process.env);
