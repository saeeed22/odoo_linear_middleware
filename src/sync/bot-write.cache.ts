import Redis from 'ioredis';
import { env } from '../config/env';

const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

const BOT_WRITE_TTL_SECONDS = 300;

export async function markBotWrite(odooId: number): Promise<void> {
  await redis.set(`bot-write:odoo:${odooId}`, '1', 'EX', BOT_WRITE_TTL_SECONDS);
}

export async function consumeBotWriteFlag(odooId: number): Promise<boolean> {
  const val = await redis.getdel(`bot-write:odoo:${odooId}`);
  return val !== null;
}
