import { z } from 'zod';
import { logger } from '../utils/logger';
import { syncQueue } from '../queue/sync-queue';
import { env } from '../config/env';

// Basic Zod schema for Linear Webhook
const linearWebhookSchema = z.object({
  action: z.string(),
  type: z.string(),
  data: z.record(z.string(), z.any()), // Can be more specific based on linear docs
  url: z.string().optional(),
  createdAt: z.string().optional(),
  organizationId: z.string().optional(),
  webhookTimestamp: z.number().optional(),
});

export async function handleLinearWebhook(rawPayload: any) {
  const parseResult = linearWebhookSchema.safeParse(rawPayload);
  
  if (!parseResult.success) {
    logger.warn({ error: parseResult.error }, 'Invalid Linear Webhook payload');
    throw new Error('Invalid payload schema');
  }

  const payload = parseResult.data;

  // Layer 1: Bot check
  // In Linear payloads, we usually have an actor field or similar. 
  // Let's assume there's an actorId in payload.data or payload.url might tell us.
  // Actually, we can just queue it and let the sync engine handle bot checks, or do it here.
  // Let's push to queue to keep webhook fast.
  
  const eventId = rawPayload.id || `${payload.action}-${payload.type}-${Date.now()}`;

  logger.info({ action: payload.action, type: payload.type }, 'Queueing Linear Webhook event');

  await syncQueue.add('linear-to-odoo', {
    eventId,
    payload: rawPayload,
  }, {
    jobId: eventId, // Acts as Layer 2: Idempotency Key in BullMQ (prevents dupes if processed within a short time)
  });
}
