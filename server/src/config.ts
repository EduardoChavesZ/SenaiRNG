import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  ADMIN_EMAIL: z.string().email().optional().or(z.literal('')),
  ADMIN_PASSWORD: z.string().min(12).optional().or(z.literal('')),
  SIGNUP_BONUS: z.coerce.number().int().nonnegative().default(100),
  DAILY_CLAIM_AMOUNT: z.coerce.number().int().positive().default(25),
  DRAW_COST: z.coerce.number().int().positive().default(10),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(5_242_880),
  UPLOAD_MAX_DIMENSION: z.coerce.number().int().positive().max(16_384).default(4_096),
  UPLOAD_MAX_PIXELS: z.coerce.number().int().positive().default(16_777_216),
  BANNER_GIF_MAX_FRAMES: z.coerce.number().int().positive().default(120),
  BANNER_GIF_MAX_DURATION_MS: z.coerce.number().int().positive().default(15_000)
});

export const config = configSchema.parse({
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? process.env.POSTGRES_URL
});
export const cookieSecure = config.COOKIE_SECURE === 'true';
