/**
 * Disposable queue smoke test.
 *
 * Reports on the BullMQ sync queue state (active/completed/failed/waiting
 * counts, plus the latest completed + failed jobs) and the corresponding
 * DB rows so you can verify end-to-end: poller → queue → worker → DB.
 *
 * Read-only; does not enqueue anything. Safe to run against any env.
 */

import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env';

const connection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

// Queue name must match the one used in src/queue/sync-queue.ts.
// Note: that queue is configured with `removeOnComplete: true`, so we will
// NOT see successful jobs in the "completed" list — that's expected.
// The authoritative evidence of success is the DB rows written below.
const queue = new Queue('sync', { connection });
const prisma = new PrismaClient();

async function main() {
  const counts = await queue.getJobCounts(
    'active',
    'completed',
    'failed',
    'waiting',
    'delayed',
    'paused'
  );
  console.log('[queue] Job counts by state:', counts);

  const [latestCompleted] = await queue.getJobs(['completed'], 0, 0, false);
  if (latestCompleted) {
    console.log('[queue] Latest completed job:', {
      id: latestCompleted.id,
      name: latestCompleted.name,
      attemptsMade: latestCompleted.attemptsMade,
      finishedOn: latestCompleted.finishedOn
        ? new Date(latestCompleted.finishedOn).toISOString()
        : null,
      dataKeys: Object.keys(latestCompleted.data ?? {}),
    });
  } else {
    console.log('[queue] No completed jobs yet.');
  }

  const failed = await queue.getJobs(['failed'], 0, 4, false);
  if (failed.length > 0) {
    console.log(`[queue] ${failed.length} failed job(s):`);
    for (const j of failed) {
      console.log('  -', {
        id: j.id,
        attemptsMade: j.attemptsMade,
        failedReason: j.failedReason,
      });
    }
  } else {
    console.log('[queue] No failed jobs.');
  }

  const mappings = await prisma.ticketMapping.findMany({
    orderBy: { updated_at: 'desc' },
    take: 5,
  });
  console.log('[db] TicketMapping rows (most recent 5):');
  for (const m of mappings) {
    console.log('  -', {
      odoo_id: m.odoo_id,
      linear_id: m.linear_id,
      sync_status: m.sync_status,
      updated_at: m.updated_at.toISOString(),
    });
  }

  const idempotency = await prisma.idempotencyKey.findMany({
    orderBy: { processed_at: 'desc' },
    take: 5,
  });
  console.log('[db] IdempotencyKey rows (most recent 5):');
  for (const k of idempotency) {
    console.log('  -', {
      event_key: k.event_key,
      source: k.source,
      processed_at: k.processed_at.toISOString(),
    });
  }
}

main()
  .catch((err) => {
    console.error('[smoke-queue] FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await queue.close();
    await connection.quit();
    await prisma.$disconnect();
  });
