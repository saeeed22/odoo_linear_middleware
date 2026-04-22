/**
 * Circuit Breaker Implementation
 * Prevents cascading failures when Odoo/Linear APIs are down
 * 
 * States:
 * - CLOSED: Normal operation
 * - OPEN: API is down, reject requests immediately
 * - HALF_OPEN: Testing if API recovered
 */

import { logger } from './logger';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  resetTimeout: number; // Time (ms) to wait before trying again
  monitorInterval: number; // Check interval for metrics
}

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  /**
   * Execute a function with circuit breaker protection
   * If circuit is OPEN, throws immediately without calling fn
   */
  async execute<T>(fn: () => Promise<T>, label: string): Promise<T> {
    if (this.state === 'OPEN') {
      const timeSinceFailure = Date.now() - (this.lastFailureTime || 0);
      if (timeSinceFailure > this.config.resetTimeout) {
        // Try recovery
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        logger.info({ label }, 'Circuit breaker entering HALF_OPEN state');
      } else {
        // Still open, reject immediately
        throw new Error(
          `Circuit breaker OPEN for ${label}. Service unavailable. Retry in ${Math.ceil(
            (this.config.resetTimeout - timeSinceFailure) / 1000
          )}s`
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess(label);
      return result;
    } catch (err) {
      this.onFailure(label);
      throw err;
    }
  }

  private onSuccess(label: string) {
    this.failureCount = 0;
    this.lastFailureTime = null;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= 2) {
        this.state = 'CLOSED';
        logger.info({ label }, 'Circuit breaker CLOSED - service recovered');
      }
    }
  }

  private onFailure(label: string) {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.config.failureThreshold && this.state === 'CLOSED') {
      this.state = 'OPEN';
      logger.warn(
        { label, failureCount: this.failureCount },
        'Circuit breaker OPEN - service unavailable'
      );
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getMetrics() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

// Create circuit breakers for Odoo and Linear
export const odooCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60000, // 60 seconds
  monitorInterval: 10000,
});

export const linearCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60000, // 60 seconds
  monitorInterval: 10000,
});
