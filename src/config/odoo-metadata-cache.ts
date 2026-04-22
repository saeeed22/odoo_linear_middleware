/**
 * Odoo Metadata Cache
 * 
 * This module caches Odoo stages and tags at startup, allowing runtime translation
 * from ID → name. This enables name-based configuration while still working with
 * Odoo's ID-only API responses.
 * 
 * Example:
 *   - Odoo returns: stage_id: [2]
 *   - Cache translates: 2 → "In Progress"
 *   - Config maps: "In Progress" → "In Progress" (Linear state name)
 */

import { odooClient } from '../adapters/odoo-client';
import { logger } from '../utils/logger';

export interface OdooMetadataCache {
  stages: Map<number, string>;      // ID → Name (e.g., 1 → "New")
  tags: Map<number, string>;        // ID → Name (e.g., 10 → "Bug")
  stagesByName: Map<string, number>; // Reverse: Name → ID
  tagsByName: Map<string, number>;   // Reverse: Name → ID
  lastUpdated: Date;
}

let cache: OdooMetadataCache = {
  stages: new Map(),
  tags: new Map(),
  stagesByName: new Map(),
  tagsByName: new Map(),
  lastUpdated: new Date(),
};

let isInitialized = false;

/**
 * Initialize the metadata cache by fetching stages and tags from Odoo
 * Call this once at app startup
 */
export async function initializeMetadataCache(): Promise<void> {
  if (isInitialized) {
    logger.debug('Metadata cache already initialized');
    return;
  }

  try {
    logger.info('Initializing Odoo metadata cache...');

    // Fetch all stages
    const stages = await odooClient.searchRead(
      'helpdesk.stage',
      [],
      ['id', 'name']
    );

    stages.forEach((stage: any) => {
      cache.stages.set(stage.id, stage.name);
      cache.stagesByName.set(stage.name.toLowerCase(), stage.id);
    });

    logger.info({ stageCount: stages.length }, 'Cached Odoo ticket stages');

    // Fetch all tags
    const tags = await odooClient.searchRead(
      'helpdesk.tag',
      [],
      ['id', 'name']
    );

    tags.forEach((tag: any) => {
      cache.tags.set(tag.id, tag.name);
      cache.tagsByName.set(tag.name.toLowerCase(), tag.id);
    });

    logger.info({ tagCount: tags.length }, 'Cached Odoo helpdesk tags');

    cache.lastUpdated = new Date();
    isInitialized = true;

    logger.info('✓ Odoo metadata cache initialized successfully');
  } catch (error) {
    logger.error(error, '✗ Failed to initialize metadata cache');
    throw error;
  }
}

/**
 * Get stage name by ID
 * Returns undefined if not found
 */
export function getStageName(stageId: number | null | undefined): string | undefined {
  if (!stageId) return undefined;
  return cache.stages.get(stageId);
}

/**
 * Get tag name by ID
 * Returns undefined if not found
 */
export function getTagName(tagId: number | null | undefined): string | undefined {
  if (!tagId) return undefined;
  return cache.tags.get(tagId);
}

/**
 * Get stage ID by name (case-insensitive)
 * Returns undefined if not found
 */
export function getStageId(stageName: string | null | undefined): number | undefined {
  if (!stageName) return undefined;
  return cache.stagesByName.get(stageName.toLowerCase());
}

/**
 * Get tag ID by name (case-insensitive)
 * Returns undefined if not found
 */
export function getTagId(tagName: string | null | undefined): number | undefined {
  if (!tagName) return undefined;
  return cache.tagsByName.get(tagName.toLowerCase());
}

/**
 * Get all cached stages
 */
export function getAllStages(): Map<number, string> {
  return cache.stages;
}

/**
 * Get all cached tags
 */
export function getAllTags(): Map<number, string> {
  return cache.tags;
}

/**
 * Check if cache is initialized
 */
export function isCacheInitialized(): boolean {
  return isInitialized;
}

/**
 * Get cache status (useful for health checks)
 */
export function getCacheStatus(): {
  initialized: boolean;
  stageCount: number;
  tagCount: number;
  lastUpdated: Date;
} {
  return {
    initialized: isInitialized,
    stageCount: cache.stages.size,
    tagCount: cache.tags.size,
    lastUpdated: cache.lastUpdated,
  };
}
