#!/usr/bin/env node
/**
 * Historical Sync Tool — Link Existing Linear Issues ↔ Odoo Tickets
 * 
 * Usage:
 *   node dist/scripts/sync-history.js --mode=csv --file=mappings.csv
 *   node dist/scripts/sync-history.js --mode=heuristic
 * 
 * CSV Format (mappings.csv):
 *   linear_id,odoo_id
 *   LINEAR-001,123
 *   LINEAR-002,456
 */

import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { linearClient } from '../adapters/linear-client';
import { odooClient } from '../adapters/odoo-client';
import crypto from 'crypto';

const prisma = new PrismaClient();

interface HistoricalMapping {
  linear_id: string;
  odoo_id: number;
}

/**
 * Mode 1: Import from CSV
 * User manually creates a CSV with Linear ↔ Odoo mappings
 */
async function importFromCsv(filePath: string) {
  logger.info({ filePath }, 'Starting CSV import...');

  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV file not found: ${filePath}`);
  }

  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const lines = fileContent.trim().split('\n');
  const header = lines[0].split(',');

  if (header[0].trim() !== 'linear_id' || header[1].trim() !== 'odoo_id') {
    throw new Error('CSV must have columns: linear_id,odoo_id');
  }

  const mappings: HistoricalMapping[] = lines.slice(1).map((line) => {
    const [linearId, odooIdStr] = line.split(',');
    return {
      linear_id: linearId.trim(),
      odoo_id: parseInt(odooIdStr.trim(), 10),
    };
  });

  logger.info({ count: mappings.length }, 'Found mappings in CSV');

  let successCount = 0;
  let errorCount = 0;

  for (const mapping of mappings) {
    try {
      // Check if mapping already exists
      const existing = await prisma.ticketMapping.findUnique({
        where: { linear_id: mapping.linear_id },
      });

      if (existing) {
        logger.warn(
          { linearId: mapping.linear_id },
          'Mapping already exists, skipping'
        );
        continue;
      }

      // Fetch both issues to create checksum
      let linearIssue: any = null;
      let odooTicket: any = null;

      try {
        linearIssue = await linearClient.issue(mapping.linear_id);
      } catch (err) {
        logger.warn({ linearId: mapping.linear_id }, 'Linear issue not found');
      }

      try {
        odooTicket = await odooClient.searchTickets([['id', '=', mapping.odoo_id]], [], 1);
        if (odooTicket.length === 0) {
          throw new Error('Odoo ticket not found');
        }
      } catch (err) {
        logger.warn({ odooId: mapping.odoo_id }, 'Odoo ticket not found');
      }

      // Create checksum from available data
      const checksumData = [
        linearIssue?.title || '',
        odooTicket?.[0]?.name || '',
        linearIssue?.state?.name || 'Unknown',
      ].join('|');
      const checksum = crypto.createHash('sha256').update(checksumData).digest('hex');

      // Create mapping
      await prisma.ticketMapping.create({
        data: {
          linear_id: mapping.linear_id,
          odoo_id: mapping.odoo_id,
          last_synced_at: new Date(),
          last_checksum: checksum,
          sync_direction: 'bidirectional',
          sync_status: 'success',
        },
      });

      logger.info(
        { linearId: mapping.linear_id, odooId: mapping.odoo_id },
        'Mapping created'
      );
      successCount++;
    } catch (err) {
      logger.error(
        { err, linearId: mapping.linear_id, odooId: mapping.odoo_id },
        'Failed to create mapping'
      );
      errorCount++;
    }
  }

  logger.info(
    { successCount, errorCount },
    'CSV import complete'
  );
  return { successCount, errorCount };
}

/**
 * Mode 2: Heuristic Matching
 * Auto-match based on title similarity + creation date
 */
async function heuristicMatching(confidenceThreshold: number = 0.8) {
  logger.info({ confidenceThreshold }, 'Starting heuristic matching...');

  try {
    // v82 SDK dropped the 2nd-argument pre-pagination; fetch the team first,
    // then request the first page of its issues via the connection fetcher.
    const teamId = process.env.LINEAR_TEAM_ID;
    if (!teamId) {
      throw new Error('LINEAR_TEAM_ID env var is required for heuristic matching');
    }

    const team = await linearClient.team(teamId);
    const issuesConnection = await team.issues({ first: 100 });
    const linearIssueNodes = issuesConnection.nodes ?? [];

    if (linearIssueNodes.length === 0) {
      throw new Error('No Linear issues returned from the team — nothing to match against');
    }

    // Fetch unmapped Odoo tickets
    const odooTickets = await odooClient.searchTickets([], ['name', 'create_date', 'id'], 100);

    logger.info(
      { linearCount: linearIssueNodes.length, odooCount: odooTickets.length },
      'Fetched issues and tickets'
    );

    const candidates: Array<{
      linearId: string;
      odooId: number;
      score: number;
    }> = [];

    // Compare each Linear issue with each Odoo ticket
    for (const linearIssue of linearIssueNodes) {
      for (const odooTicket of odooTickets) {
        const score = calculateMatchScore(linearIssue, odooTicket);

        if (score >= confidenceThreshold) {
          candidates.push({
            linearId: linearIssue.id,
            odooId: odooTicket.id,
            score,
          });
        }
      }
    }

    // Sort by score (highest first) and create mappings for best matches
    candidates.sort((a, b) => b.score - a.score);

    let successCount = 0;
    const manualReviewQueue: typeof candidates = [];

    for (const candidate of candidates) {
      try {
        // Double-check no mapping exists
        const existing = await prisma.ticketMapping.findUnique({
          where: { linear_id: candidate.linearId },
        });

        if (existing) continue;

        // High confidence: auto-link
        if (candidate.score >= 0.8) {
          await prisma.ticketMapping.create({
            data: {
              linear_id: candidate.linearId,
              odoo_id: candidate.odooId,
              last_synced_at: new Date(),
              last_checksum: 'auto-matched',
              sync_status: 'success',
            },
          });

          logger.info(
            { score: candidate.score },
            `Auto-linked ${candidate.linearId} ↔ ${candidate.odooId}`
          );
          successCount++;
        } else {
          // Medium confidence: manual review
          manualReviewQueue.push(candidate);
        }
      } catch (err) {
        logger.error({ err, candidate }, 'Failed to create mapping');
      }
    }

    // Output manual review queue to CSV
    if (manualReviewQueue.length > 0) {
      const csvContent = [
        'linear_id,odoo_id,confidence_score',
        ...manualReviewQueue.map((c) => `${c.linearId},${c.odooId},${c.score}`),
      ].join('\n');

      const outputPath = path.join(process.cwd(), 'manual-review-queue.csv');
      fs.writeFileSync(outputPath, csvContent);

      logger.info(
        { path: outputPath, count: manualReviewQueue.length },
        'Manual review queue saved'
      );
    }

    logger.info({ successCount, manualReviewCount: manualReviewQueue.length }, 'Heuristic matching complete');
    return { successCount, manualReviewCount: manualReviewQueue.length };
  } catch (err) {
    logger.error({ err }, 'Heuristic matching failed');
    throw err;
  }
}

/**
 * Calculate match score (0-1) between Linear issue and Odoo ticket
 * Factors:
 * - Title similarity (60%)
 * - Creation date proximity (30%)
 * - Creator match (10%)
 */
function calculateMatchScore(linearIssue: any, odooTicket: any): number {
  let score = 0;

  // Title similarity (Levenshtein distance approximation)
  const linearTitle = linearIssue.title.toLowerCase();
  const odooTitle = odooTicket.name.toLowerCase();
  const titleSimilarity = calculateStringSimilarity(linearTitle, odooTitle);
  score += titleSimilarity * 0.6;

  // Date proximity (within 1 hour = 1.0, beyond 24h = 0.0)
  if (linearIssue.createdAt && odooTicket.create_date) {
    const linearDate = new Date(linearIssue.createdAt).getTime();
    const odooDate = new Date(odooTicket.create_date).getTime();
    const hoursDiff = Math.abs(linearDate - odooDate) / (1000 * 60 * 60);
    const dateSimilarity = Math.max(0, 1 - hoursDiff / 24); // Decay over 24 hours
    score += dateSimilarity * 0.3;
  }

  return Math.min(1, score);
}

/**
 * Simple string similarity (0-1)
 * Uses Levenshtein distance ratio
 */
function calculateStringSimilarity(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) return 1.0;

  const editDistance = getLevenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Levenshtein distance (edit distance between two strings)
 */
function getLevenshteinDistance(a: string, b: string): number {
  const dp: number[][] = Array(b.length + 1)
    .fill(null)
    .map(() => Array(a.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) dp[0][i] = i;
  for (let j = 0; j <= b.length; j++) dp[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j][i] = Math.min(
        dp[j][i - 1] + 1,
        dp[j - 1][i] + 1,
        dp[j - 1][i - 1] + indicator
      );
    }
  }

  return dp[b.length][a.length];
}

/**
 * Main CLI
 */
async function main() {
  const args = process.argv.slice(2);
  const mode = args.find((a) => a.startsWith('--mode='))?.split('=')[1];
  const file = args.find((a) => a.startsWith('--file='))?.split('=')[1];

  try {
    if (mode === 'csv') {
      if (!file) throw new Error('--file required for CSV mode');
      await importFromCsv(file);
    } else if (mode === 'heuristic') {
      await heuristicMatching();
    } else {
      console.log(`
Historical Sync Tool

Usage:
  CSV Import:      node dist/scripts/sync-history.js --mode=csv --file=mappings.csv
  Heuristic Match: node dist/scripts/sync-history.js --mode=heuristic

CSV Format:
  linear_id,odoo_id
  LINEAR-001,123
  LINEAR-002,456
      `);
    }

    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Historical sync failed');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
