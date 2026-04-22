/**
 * Resolve a stored TicketMapping into a clickable Linear URL.
 *
 * Usage:
 *   npm run linear:find -- <odooTicketId>        # lookup by Odoo ticket id
 *   npm run linear:find -- --linear <uuid>       # lookup by Linear issue UUID
 *   npm run linear:find                          # dump the last 5 mappings
 *
 * Why this script exists: Linear's UI doesn't let you paste an internal
 * UUID into the search box — URLs use the short `TEAM-123` identifier
 * instead. This fetches `identifier`, `title`, and `url` via the SDK so
 * you can jump straight to the issue without guessing by title.
 */

import { PrismaClient } from '@prisma/client';
import { linearClient } from '../src/adapters/linear-client';

const prisma = new PrismaClient();

async function printIssue(linearId: string, odooId?: number) {
  const issue = await linearClient.issue(linearId);
  console.log('  →', {
    odooId: odooId ?? '(unknown)',
    linearId,
    identifier: issue.identifier,
    title: issue.title,
    state: (await issue.state)?.name,
    url: issue.url,
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--linear' && args[1]) {
    await printIssue(args[1]);
    return;
  }

  if (args[0]) {
    const odooId = Number.parseInt(args[0], 10);
    if (Number.isNaN(odooId)) {
      throw new Error(`Expected a numeric Odoo ticket id, got "${args[0]}"`);
    }

    const mapping = await prisma.ticketMapping.findUnique({ where: { odoo_id: odooId } });
    if (!mapping) {
      console.log(`[find] No TicketMapping row for odoo_id=${odooId}.`);
      return;
    }
    await printIssue(mapping.linear_id, mapping.odoo_id);
    return;
  }

  const mappings = await prisma.ticketMapping.findMany({
    orderBy: { updated_at: 'desc' },
    take: 5,
  });

  if (mappings.length === 0) {
    console.log('[find] No TicketMapping rows yet.');
    return;
  }

  console.log(`[find] Resolving ${mappings.length} most recent mapping(s):`);
  for (const m of mappings) {
    await printIssue(m.linear_id, m.odoo_id);
  }
}

main()
  .catch((err) => {
    console.error('[find] FAILED:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
