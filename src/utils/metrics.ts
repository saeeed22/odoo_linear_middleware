/**
 * Prometheus Metrics for Observability
 * Exposes metrics for monitoring systems
 * 
 * Access at: http://localhost:3000/metrics
 */

import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export const register = new Registry();

// Counter: Total sync events
export const syncCounter = new Counter({
  name: 'sync_total',
  help: 'Total number of sync events',
  labelNames: ['direction', 'status'], // direction: linear_to_odoo, odoo_to_linear
  registers: [register],
});

// Counter: API calls
export const apiCallCounter = new Counter({
  name: 'api_calls_total',
  help: 'Total API calls to Odoo and Linear',
  labelNames: ['api', 'endpoint', 'status'], // api: odoo, linear
  registers: [register],
});

// Histogram: Sync duration
export const syncDuration = new Histogram({
  name: 'sync_duration_ms',
  help: 'Sync operation duration in milliseconds',
  labelNames: ['direction'],
  buckets: [100, 500, 1000, 5000, 10000],
  registers: [register],
});

// Histogram: API latency
export const apiLatency = new Histogram({
  name: 'api_latency_ms',
  help: 'API call latency in milliseconds',
  labelNames: ['api'],
  buckets: [50, 200, 500, 1000, 2000],
  registers: [register],
});

// Gauge: Queue depth
export const queueDepth = new Gauge({
  name: 'queue_depth',
  help: 'Current sync queue depth',
  registers: [register],
});

// Gauge: DLQ size
export const dlqSize = new Gauge({
  name: 'dlq_size',
  help: 'Dead Letter Queue size',
  registers: [register],
});

// Counter: Comments synced
export const commentCounter = new Counter({
  name: 'comments_synced_total',
  help: 'Total comments synced',
  labelNames: ['direction'],
  registers: [register],
});

// Counter: Assignees updated
export const assigneeCounter = new Counter({
  name: 'assignees_updated_total',
  help: 'Total assignee updates',
  labelNames: ['direction'],
  registers: [register],
});

// Counter: Tags synced
export const tagCounter = new Counter({
  name: 'tags_synced_total',
  help: 'Total tags/labels synced',
  labelNames: ['direction'],
  registers: [register],
});

/**
 * Helper: Record sync event
 */
export function recordSync(direction: 'linear_to_odoo' | 'odoo_to_linear', status: 'success' | 'failed') {
  syncCounter.labels(direction, status).inc();
}

/**
 * Helper: Record API call
 */
export function recordApiCall(
  api: 'odoo' | 'linear',
  endpoint: string,
  status: 'success' | 'failed' | 'timeout'
) {
  apiCallCounter.labels(api, endpoint, status).inc();
}

/**
 * Helper: Record duration
 */
export function recordSyncDuration(direction: 'linear_to_odoo' | 'odoo_to_linear', ms: number) {
  syncDuration.labels(direction).observe(ms);
}

/**
 * Helper: Record API latency
 */
export function recordApiLatency(api: 'odoo' | 'linear', ms: number) {
  apiLatency.labels(api).observe(ms);
}

// Metrics endpoint (add to Express app)
// register.metrics() is async in prom-client v14+
export async function metricsHandler(req: any, res: any) {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).send('Error collecting metrics');
  }
}
