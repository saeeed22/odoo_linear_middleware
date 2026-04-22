/**
 * Operational helper: removes every job in the BullMQ `failed` set of the
 * `sync` queue.
 *
 * When to use:
 *   - After fixing a systemic bug (e.g. a DB migration) that caused a wave
 *     of legitimate-but-now-stale failures.
 *   - During development when you want a clean queue state.
 *
 * When NOT to use:
 *   - On a live production incident — failed jobs are your forensic
 *     evidence. Triage first, drain second.
 *
 * The script only clears FAILED jobs. Active/waiting jobs are untouched.
 */

import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../src/config/env';

const connection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

const queue = new Queue('sync', { connection });

async function main() {
  const before = await queue.getJobCounts('failed');
  console.log(`[drain] Failed jobs before: ${before.failed}`);

  if (before.failed === 0) {
    console.log('[drain] Nothing to do.');
    return;
  }

  // Passing `0` as the grace period + removing ALL failed jobs.
  // BullMQ's clean() returns the removed job IDs.
  const removed = await queue.clean(0, Number.MAX_SAFE_INTEGER, 'failed');
  console.log(`[drain] Removed ${removed.length} failed job(s).`);

  const after = await queue.getJobCounts('failed');
  console.log(`[drain] Failed jobs after: ${after.failed}`);
}

main()
  .catch((err) => {
    console.error('[drain] FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await queue.close();
    await connection.quit();
  });
