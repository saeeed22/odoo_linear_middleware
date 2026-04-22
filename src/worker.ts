import { startWorker } from './queue/worker';
import { logger } from './utils/logger';

logger.info('Starting Sync Worker...');
startWorker();
