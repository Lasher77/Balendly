import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  PORT: z.string().default('3000').transform(Number),
  BASE_URL: z.string().url().default('http://localhost:3000'),
  SQLITE_PATH: z.string().default('./data/app.db'),
  ADMIN_SESSION_SECRET: z.string().min(16),
  MICROSOFT_TENANT_ID: z.string().default('common'),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_ORGANIZER_EMAIL: z.string().email().optional(),
  MICROSOFT_REDIRECT_URI: z.string().url().optional(),
  N8N_WEBHOOK_URL: z.string().url().optional(),
  N8N_WEBHOOK_SECRET: z.string().optional()
});

export const env = schema.parse(process.env);
