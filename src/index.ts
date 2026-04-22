import { startServer } from './app';
import { logger } from './utils/logger';
import { startOdooPoller, stopOdooPoller } from './polling/odoo-poller';
import { initializeMetadataCache } from './config/odoo-metadata-cache';
import { startWorker, syncWorker } from './queue/worker';

logger.info('Starting Webhook Server...');
startServer();

logger.info('Starting sync queue worker...');
startWorker();

logger.info('Initializing Odoo metadata cache...');
initializeMetadataCache()
  .then(() => {
    logger.info('✓ Odoo metadata cache initialized');
    logger.info('Initializing Odoo Poller...');
    startOdooPoller();
  })
  .catch((err) => {
    logger.error(err, '✗ Failed to initialize metadata cache, exiting');
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  stopOdooPoller();
  await syncWorker.close();
});
process.on('SIGINT', async () => {
  stopOdooPoller();
  await syncWorker.close();
});
