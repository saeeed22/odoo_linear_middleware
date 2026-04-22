import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  DATABASE_URL: z.string().url(),
  
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().default('6379').transform(Number),
  REDIS_PASSWORD: z.string().optional(),
  
  LINEAR_API_KEY: z.string().min(1),
  LINEAR_WEBHOOK_SECRET: z.string().min(1),
  LINEAR_BOT_USER_ID: z.string().min(1),
  LINEAR_TEAM_ID: z.string().min(1),
  
  ODOO_BASE_URL: z.string().url(),
  ODOO_DB: z.string().min(1),
  ODOO_USERNAME: z.string().min(1),
  ODOO_PASSWORD: z.string().optional().default(''),
  ODOO_API_KEY: z.string().optional(),
  ODOO_BOT_USER_ID: z.string().transform(Number),
  
  ODOO_POLL_INTERVAL_MS: z.string().default('30000').transform(Number),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', JSON.stringify(parsedEnv.error.format(), null, 2));
  process.exit(1);
}

export const env = parsedEnv.data;
