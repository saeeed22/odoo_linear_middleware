import express from 'express';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { env } from './config/env';
import { logger } from './utils/logger';
import { handleLinearWebhook } from './webhooks/linear';
import { syncQueue } from './queue/sync-queue';
import { odooClient } from './adapters/odoo-client';
import { linearClient } from './adapters/linear-client';
import { metricsHandler } from './utils/metrics';

const app = express();
const prisma = new PrismaClient();

// Middleware to capture raw body for signature verification
app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  },
  // Limit payload size to prevent DoS
  limit: '1mb'
}));

// Health check with dependency verification
app.get('/health', async (req, res) => {
  try {
    const health: any = { status: 'ok' };

    // Check Database
    try {
      await prisma.$queryRaw`SELECT 1`;
      health.db = 'ok';
    } catch (err) {
      health.db = 'error';
      health.dbError = err instanceof Error ? err.message : 'Unknown error';
    }

    // Check Redis (via queue) — client is Promise<RedisClient> in BullMQ v5
    try {
      const redisClient = await syncQueue.client;
      await redisClient.ping();
      health.redis = 'ok';
    } catch (err) {
      health.redis = 'error';
      health.redisError = err instanceof Error ? err.message : 'Unknown error';
    }

    // Check Odoo
    try {
      // Test JSON-RPC connection with API key authentication
      await odooClient.testConnection();
      health.odoo = 'ok';
    } catch (err) {
      health.odoo = 'error';
      health.odooError = err instanceof Error ? err.message : 'Unknown error';
    }

    // Check Linear
    try {
      // Simple test: fetch current user (requires API key)
      await linearClient.viewer();
      health.linear = 'ok';
    } catch (err) {
      health.linear = 'error';
      health.linearError = err instanceof Error ? err.message : 'Unknown error';
    }

    const hasErrors = Object.values(health).some(v => v === 'error');
    const statusCode = hasErrors ? 503 : 200;

    res.status(statusCode).json(health);
  } catch (error) {
    logger.error(error, 'Health check error');
    res.status(500).json({ status: 'error', error: 'Health check failed' });
  }
});

// Stats endpoint for monitoring
app.get('/stats', async (req, res) => {
  try {
    // Get queue depth
    const jobCounts = await syncQueue.getJobCounts();
    const queueDepth = jobCounts.active + jobCounts.waiting;

    // Get last sync time
    const lastSync = await prisma.syncLog.findFirst({
      where: { status: 'success' },
      orderBy: { created_at: 'desc' },
      select: { created_at: true }
    });

    // Get 24h metrics
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last24hLogs = await prisma.syncLog.groupBy({
      by: ['source', 'status'],
      where: { created_at: { gte: oneDayAgo } },
      _count: true
    });

    const last24h: any = {
      linearToOdoo: 0,
      odooToLinear: 0,
      failed: 0
    };

    for (const log of last24hLogs) {
      if (log.status === 'failed') {
        last24h.failed += log._count;
      } else if (log.source === 'linear') {
        last24h.linearToOdoo += log._count;
      } else if (log.source === 'odoo') {
        last24h.odooToLinear += log._count;
      }
    }

    // Get DLQ size (failed jobs)
    const dlq = await syncQueue.getFailed(0, -1);

    res.json({
      queueDepth,
      lastSyncAt: lastSync?.created_at || null,
      last24h,
      dlqSize: dlq.length,
      jobCounts: {
        active: jobCounts.active,
        waiting: jobCounts.waiting,
        completed: jobCounts.completed,
        failed: jobCounts.failed
      }
    });
  } catch (error) {
    logger.error(error, 'Stats endpoint error');
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Prometheus metrics endpoint
app.get('/metrics', (req, res) => {
  metricsHandler(req, res);
});

app.post('/webhooks/linear', async (req: any, res: any) => {
  const signature = req.headers['linear-signature'] as string;
  const timestampHeader = req.headers['linear-delivery-timestamp'] as string;

  if (!signature || !timestampHeader) {
    logger.warn('Missing signature or timestamp headers');
    return res.status(401).send('Missing headers');
  }

  // Verify Timestamp (5 minute tolerance)
  const timestamp = Number(timestampHeader);
  const timeDiff = Math.abs(Date.now() - timestamp);
  if (timeDiff > 5 * 60 * 1000) {
    logger.warn({ timeDiff }, 'Stale event rejected');
    return res.status(401).send('Stale event');
  }

  // Verify Signature
  const expectedSignature = crypto
    .createHmac('sha256', env.LINEAR_WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest('hex');

  // timingSafeEqual requires equal-length buffers; length mismatch means invalid signature
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  let signatureValid = false;
  try {
    signatureValid = sigBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    logger.warn('Invalid signature');
    return res.status(401).send('Invalid signature');
  }

  try {
    await handleLinearWebhook(req.body);
    res.status(200).send('OK');
  } catch (error: any) {
    logger.error(error, 'Error handling linear webhook');
    res.status(500).send('Internal Server Error');
  }
});

export function startServer() {
  const server = app.listen(env.PORT, () => {
    logger.info(`Server listening on port ${env.PORT}`);
  });

  // Graceful shutdown handling
  const shutdown = () => {
    logger.info('SIGTERM/SIGINT received, shutting down gracefully...');
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
