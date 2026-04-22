// Test Helpers for Phase 2 Integration Testing
// Usage: npm test (after setting .env)

import { linearClient } from '../adapters/linear-client';
import { odooClient } from '../adapters/odoo-client';
import { logger } from './logger';
import { env } from '../config/env';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Simplified Prisma client for testing
const testDb = require('@prisma/client').PrismaClient;

/**
 * Test helper: Create a Linear issue for testing
 */
export async function createTestLinearIssue(title: string, description: string) {
  try {
    logger.info(`Creating test Linear issue: ${title}`);
    const result = await linearClient.createIssue({
      teamId: env.LINEAR_TEAM_ID,
      title,
      description,
    });
    return result;
  } catch (error) {
    logger.error(error, 'Failed to create test Linear issue');
    throw error;
  }
}

/**
 * Test helper: Create an Odoo helpdesk ticket for testing
 */
export async function createTestOdooTicket(name: string, description: string) {
  try {
    logger.info(`Creating test Odoo ticket: ${name}`);
    // Test connection to Odoo with API key authentication
    await odooClient.testConnection();
    const ticketId = await odooClient.createTicket({
      name,
      description,
    });
    return ticketId;
  } catch (error) {
    logger.error(error, 'Failed to create test Odoo ticket');
    throw error;
  }
}

/**
 * Test helper: Check if a Linear issue was synced to Odoo
 */
export async function checkLinearSyncedToOdoo(linearId: string, timeoutMs = 5000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const mapping = await prisma.ticketMapping.findUnique({
        where: { linear_id: linearId }
      });
      
      if (mapping) {
        logger.info(`✅ Linear issue ${linearId} synced to Odoo ticket ${mapping.odoo_id}`);
        return mapping;
      }
    } catch (error) {
      logger.debug('Mapping not yet created, retrying...');
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  logger.error(`❌ Linear issue ${linearId} did NOT sync to Odoo within ${timeoutMs}ms`);
  return null;
}

/**
 * Test helper: Check if an Odoo ticket was synced to Linear
 */
export async function checkOdooSyncedToLinear(odooId: number, timeoutMs = 35000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const mapping = await prisma.ticketMapping.findUnique({
        where: { odoo_id: odooId }
      });
      
      if (mapping) {
        logger.info(`✅ Odoo ticket ${odooId} synced to Linear issue ${mapping.linear_id}`);
        return mapping;
      }
    } catch (error) {
      logger.debug('Mapping not yet created, retrying...');
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  logger.error(`❌ Odoo ticket ${odooId} did NOT sync to Linear within ${timeoutMs}ms`);
  return null;
}

/**
 * Test helper: Verify no infinite loop (check sync logs)
 */
export async function verifyNoInfiniteLoop(correlationId: string) {
  try {
    const logs = await prisma.syncLog.findMany({
      where: { correlation_id: correlationId },
      orderBy: { created_at: 'asc' }
    });
    
    if (logs.length > 2) {
      logger.error(`❌ Possible infinite loop detected: ${logs.length} syncs for same correlation_id`);
      return false;
    }
    
    logger.info(`✅ No infinite loop detected (${logs.length} syncs total)`);
    return true;
  } catch (error) {
    logger.error(error, 'Failed to verify loop prevention');
    throw error;
  }
}

/**
 * Test helper: Check health endpoint
 */
export async function checkHealth(baseUrl = `http://localhost:${env.PORT}`) {
  try {
    const response = await fetch(`${baseUrl}/health`);
    const health = await response.json();
    
    logger.info({ health }, 'Health check result');
    
    const allOk = Object.entries(health)
      .filter(([k]) => !k.includes('Error'))
      .every(([, v]) => v === 'ok');
    
    if (allOk) {
      logger.info('✅ All services healthy');
    } else {
      logger.error(`❌ Some services unhealthy: ${JSON.stringify(health)}`);
    }
    
    return health;
  } catch (error) {
    logger.error(error, 'Health check failed');
    throw error;
  }
}

/**
 * Test helper: Get sync statistics
 */
export async function getStats(baseUrl = `http://localhost:${env.PORT}`) {
  try {
    const response = await fetch(`${baseUrl}/stats`);
    const stats = await response.json();
    
    logger.info({ stats }, 'Sync statistics');
    return stats;
  } catch (error) {
    logger.error(error, 'Failed to get stats');
    throw error;
  }
}

/**
 * Test helper: Clean up test data
 */
export async function cleanupTestData(linearIds: string[] = [], odooIds: number[] = []) {
  try {
    // Note: We don't actually delete from Linear/Odoo (could be destructive)
    // Just remove the mappings from our DB
    
    for (const linearId of linearIds) {
      await prisma.ticketMapping.deleteMany({
        where: { linear_id: linearId }
      });
    }
    
    for (const odooId of odooIds) {
      await prisma.ticketMapping.deleteMany({
        where: { odoo_id: odooId }
      });
    }
    
    logger.info(`✅ Cleaned up ${linearIds.length + odooIds.length} test mappings`);
  } catch (error) {
    logger.error(error, 'Cleanup failed');
  }
}

// Export Prisma for direct queries if needed
export { prisma };
