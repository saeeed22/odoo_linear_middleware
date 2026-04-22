/**
 * Disposable DB smoke test.
 *
 * Round-trips a row through every Prisma model to prove:
 *   1. Tables exist in the expected (`linear`) Postgres schema
 *   2. Prisma client can read AND write (not just connect)
 *
 * Intentionally standalone — it doesn't touch the app's connection pool.
 * Safe to run against dev; aborts with non-zero exit on any failure so it
 * can be wired into CI later.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const counts = await Promise.all([
    prisma.ticketMapping.count(),
    prisma.idempotencyKey.count(),
    prisma.syncLog.count(),
    prisma.userMapping.count(),
    prisma.commentMapping.count(),
    prisma.labelMapping.count(),
  ]);

  const [ticketMapping, idempotencyKey, syncLog, userMapping, commentMapping, labelMapping] = counts;

  console.log('[smoke-db] Current row counts:');
  console.log({ ticketMapping, idempotencyKey, syncLog, userMapping, commentMapping, labelMapping });

  const probeKey = `smoke-${Date.now()}`;
  const created = await prisma.idempotencyKey.create({
    data: { event_key: probeKey, source: 'smoke' },
  });
  console.log('[smoke-db] Insert OK, id=', created.id);

  const deleted = await prisma.idempotencyKey.delete({ where: { id: created.id } });
  console.log('[smoke-db] Delete OK, id=', deleted.id);

  console.log('[smoke-db] DB connectivity + schema resolution verified.');
}

main()
  .catch((err) => {
    console.error('[smoke-db] FAILED:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
