import { Worker } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import Redis from 'ioredis';
import { processLinearToOdoo } from '../sync/linear-to-odoo';
import { processOdooToLinear } from '../sync/odoo-to-linear';

const connection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

export const syncWorker = new Worker('sync', async (job) => {
  logger.info({ jobId: job.id, name: job.name, data: JSON.stringify(job.data).substring(0, 200) }, 'Worker picked up job — starting processing');

  try {
    if (job.name === 'linear-to-odoo') {
      await processLinearToOdoo(job.data);
    } else if (job.name === 'odoo-to-linear') {
      await processOdooToLinear(job.data);
    } else {
      logger.warn({ jobId: job.id, name: job.name }, 'Unknown job name — no handler registered, skipping');
    }
  } catch (error) {
    logger.error({ jobId: job.id, name: job.name, error }, 'Job processing failed with error');
    throw error;
  }
}, {
  connection,
  concurrency: 5,
});

syncWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Job completed successfully');
});

syncWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Job failed');
});

export function startWorker() {
  logger.info('Sync worker started');

  const shutdown = () => {
    logger.info('SIGTERM/SIGINT received, shutting down worker gracefully...');
    syncWorker.close().then(() => {
      logger.info('Worker closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
