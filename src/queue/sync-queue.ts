import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const connection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

connection.on('error', (err) => {
  logger.error(err, 'Redis connection error');
});

export const syncQueue = new Queue('sync', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: 100, // Keep last 100 failed jobs for inspection
  },
});

export const queueEvents = new QueueEvents('sync', { connection });

queueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error({ jobId, failedReason }, 'Job failed');
});

// We will setup the worker in a separate file (e.g. src/queue/worker.ts)
// so that it can be started independently if needed.
