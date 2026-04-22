import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { odooClient } from '../adapters/odoo-client';
import { syncQueue } from '../queue/sync-queue';

const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

async function getPersistentTimestamp(key: string): Promise<Date> {
  const val = await redis.get(key);
  if (!val) {
    // If no previous poll timestamp, default to 5 minutes ago to avoid syncing history unnecessarily
    return new Date(Date.now() - 5 * 60 * 1000);
  }
  return new Date(val);
}

async function setPersistentTimestamp(key: string, date: Date) {
  await redis.set(key, date.toISOString());
}

let isPolling = false;

export async function pollOdoo() {
  if (isPolling) return;
  isPolling = true;

  try {
    const lastPollTimestamp = await getPersistentTimestamp('odoo_poll_timestamp');
    const overlapTimestamp = new Date(lastPollTimestamp.getTime() - 60000); // 1-minute overlap

    logger.debug({ overlapTimestamp }, 'Polling Odoo for changes...');

    // Odoo's default date format for domain filters is 'YYYY-MM-DD HH:mm:ss' (UTC)
    const odooDateString = overlapTimestamp.toISOString().replace('T', ' ').substring(0, 19);

    const recentTickets = await odooClient.searchTickets([
      ['write_date', '>=', odooDateString]
    ], [
      'id', 'name', 'description', 'stage_id', 'user_id', 'tag_ids', 'write_uid', 'write_date'
    ]);

    if (recentTickets.length > 0) {
      logger.info(`Found ${recentTickets.length} recently changed tickets in Odoo`);
    }

    for (const ticket of recentTickets) {
      const jobId = `odoo-ticket-${ticket.id}-${ticket.write_date}`;
      logger.info({ ticketId: ticket.id, ticketName: ticket.name, jobId }, 'Enqueueing ticket for sync');

      const job = await syncQueue.add('odoo-to-linear', { ticket }, { jobId });

      logger.info({ ticketId: ticket.id, jobId: job.id }, 'Ticket enqueued successfully');
    }

    await setPersistentTimestamp('odoo_poll_timestamp', new Date());

  } catch (error) {
    logger.error(error, 'Error during Odoo polling cycle');
  } finally {
    isPolling = false;
  }
}

let pollIntervalId: NodeJS.Timeout;

export function startOdooPoller() {
  logger.info(`Starting Odoo poller (Interval: ${env.ODOO_POLL_INTERVAL_MS}ms)`);
  
  // Initial poll immediately
  pollOdoo();

  pollIntervalId = setInterval(() => {
    pollOdoo();
  }, env.ODOO_POLL_INTERVAL_MS);
}

export function stopOdooPoller() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    logger.info('Odoo poller stopped');
  }
}
