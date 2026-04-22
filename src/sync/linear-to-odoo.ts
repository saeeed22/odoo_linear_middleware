import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { convertMarkdownToHtml } from '../utils/rich-text';
import { odooClient } from '../adapters/odoo-client';
import { getIssueComments } from '../adapters/linear-client';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { STATUS_MAP } from '../config/status-mapping';
import { TAG_MAP } from '../config/tag-mapping';
import { getStageId, getTagId } from '../config/odoo-metadata-cache';

const prisma = new PrismaClient();

/**
 * Enhanced checksum calculation
 * Includes: title, description, status, assignee, labels, comment count
 */
function calculateChecksum(issue: any, commentCount: number = 0): string {
  const title = issue.title || '';
  const description = issue.description || '';
  const status = issue.state?.name || 'Todo';
  const assigneeId = issue.assignee?.id || '';
  const labelIds = (issue.labels?.nodes || []).map((l: any) => l.id).sort().join(',');

  const checksumString = `${title}|${description}|${status}|${assigneeId}|${labelIds}|${commentCount}`;
  return crypto.createHash('sha256').update(checksumString).digest('hex');
}

export async function processLinearToOdoo(data: any) {
  const { eventId, payload } = data;
  const linearIssue = payload.data;
  
  if (!linearIssue || payload.type !== 'Issue') {
    logger.info('Skipping non-issue event');
    return;
  }

  const linearId = linearIssue.id;

  // Layer 1: Bot Check
  const actorId = payload.actor?.id || payload.updatedBy?.id || linearIssue.creator?.id;
  if (actorId === env.LINEAR_BOT_USER_ID) {
    logger.info({ linearId, actorId }, 'Skipping bot-triggered update');
    return;
  }
  
  // Layer 2: Idempotency Key
  const idempotencyExists = await prisma.idempotencyKey.findUnique({
    where: { event_key: eventId }
  });

  if (idempotencyExists) {
    logger.info({ eventId }, 'Event already processed, skipping (Idempotency)');
    return;
  }

  // Layer 3: Enhanced Checksum
  const comments = await getIssueComments(linearId).catch(() => []);
  const checksum = calculateChecksum(linearIssue, comments.length);

  // Convert markdown to HTML for Odoo
  const htmlDescription = convertMarkdownToHtml(linearIssue.description || '');

  // Check Mapping
  let mapping = await prisma.ticketMapping.findUnique({
    where: { linear_id: linearId }
  });

  try {
    if (!mapping) {
      // Create in Odoo
      logger.info({ linearId }, 'Creating new ticket in Odoo');
      
      // Get Linear state name
      const linearStateName = linearIssue.state?.name;
      
      // Map Linear state name → Odoo stage name → Odoo stage ID
      const odooStageName = STATUS_MAP[linearStateName];
      const stageId = odooStageName ? getStageId(odooStageName) : null;
      
      if (linearStateName && !odooStageName) {
        logger.warn(
          { linearStateName },
          'Linear state not in STATUS_MAP, ticket will be unassigned status'
        );
      } else if (odooStageName && !stageId) {
        logger.warn(
          { odooStageName },
          'Odoo stage not found in cache, ticket will be unassigned status'
        );
      }
      
      const ticketData: any = {
        name: linearIssue.title,
        description: htmlDescription,
        stage_id: stageId ?? null,
      };

      // Add assignee if exists
      if (linearIssue.assignee?.email) {
        const userMapping = await prisma.userMapping.findUnique({
          where: { linear_email: linearIssue.assignee.email }
        });
        if (userMapping?.odoo_user_id) {
          ticketData.user_id = userMapping.odoo_user_id;
        } else {
          logger.warn(
            { linearEmail: linearIssue.assignee.email },
            'No user mapping found for Linear user, leaving unassigned'
          );
        }
      }

      // Add tags/labels if exist
      if (linearIssue.labels?.nodes && linearIssue.labels.nodes.length > 0) {
        const tagIds = linearIssue.labels.nodes
          .map((label: any) => {
            // Linear label name → Odoo tag name (from TAG_MAP)
            const odooTagName = TAG_MAP[label.name];
            if (!odooTagName) {
              logger.debug({ labelName: label.name }, 'Linear label not in TAG_MAP, skipping');
              return null;
            }
            // Odoo tag name → Odoo tag ID (from cache)
            const tagId = getTagId(odooTagName);
            if (!tagId) {
              logger.warn({ odooTagName }, 'Odoo tag not found in cache');
              return null;
            }
            return tagId;
          })
          .filter((id: any) => id !== null);
        
        if (tagIds.length > 0) {
          ticketData.tag_ids = [[6, 0, tagIds]];
        }
      }

      const odooTicketId = await odooClient.createTicket(ticketData);

      mapping = await prisma.ticketMapping.create({
        data: {
          linear_id: linearId,
          odoo_id: odooTicketId,
          last_synced_at: new Date(),
          last_checksum: checksum,
          sync_direction: 'linear-to-odoo'
        }
      });

      // Sync comments (append-only)
      await syncLinearCommentsToOdoo(linearId, mapping.odoo_id, comments, mapping.id);
    } else {
      // Update in Odoo
      if (mapping.last_checksum === checksum) {
        logger.info({ linearId }, 'Checksum matches, skipping update');
        await prisma.idempotencyKey.create({
          data: { event_key: eventId, source: 'linear' }
        }).catch(() => {});
        return;
      }

      logger.info({ linearId, odooId: mapping.odoo_id }, 'Updating ticket in Odoo');
      
      // Get Linear state name
      const linearStateName = linearIssue.state?.name;
      
      // Map Linear state name → Odoo stage name → Odoo stage ID
      const odooStageName = STATUS_MAP[linearStateName];
      const stageId = odooStageName ? getStageId(odooStageName) : null;
      
      if (linearStateName && !odooStageName) {
        logger.warn({ linearStateName }, 'Linear state not in STATUS_MAP');
      } else if (odooStageName && !stageId) {
        logger.warn({ odooStageName }, 'Odoo stage not found in cache');
      }
      
      const updateData: any = {
        name: linearIssue.title,
        description: htmlDescription,
        stage_id: stageId ?? null,
      };

      // Update assignee
      if (linearIssue.assignee?.email) {
        const userMapping = await prisma.userMapping.findUnique({
          where: { linear_email: linearIssue.assignee.email }
        });
        if (userMapping?.odoo_user_id) {
          updateData.user_id = userMapping.odoo_user_id;
        } else {
          updateData.user_id = null; // Unassign if no mapping
          logger.warn(
            { linearEmail: linearIssue.assignee.email },
            'No user mapping found, unassigning'
          );
        }
      } else {
        updateData.user_id = null; // Unassign
      }

      // Update tags/labels
      if (linearIssue.labels?.nodes) {
        const tagIds = linearIssue.labels.nodes
          .map((label: any) => {
            // Linear label name → Odoo tag name (from TAG_MAP)
            const odooTagName = TAG_MAP[label.name];
            if (!odooTagName) {
              logger.debug({ labelName: label.name }, 'Linear label not in TAG_MAP, skipping');
              return null;
            }
            // Odoo tag name → Odoo tag ID (from cache)
            const tagId = getTagId(odooTagName);
            if (!tagId) {
              logger.warn({ odooTagName }, 'Odoo tag not found in cache');
              return null;
            }
            return tagId;
          })
          .filter((id: any) => id !== null);
        
        updateData.tag_ids = [[6, 0, tagIds]];
      }

      await odooClient.updateTicket(mapping.odoo_id, updateData);

      // Sync new comments
      await syncLinearCommentsToOdoo(linearId, mapping.odoo_id, comments, mapping.id);

      await prisma.ticketMapping.update({
        where: { id: mapping.id },
        data: {
          last_synced_at: new Date(),
          last_checksum: checksum,
          updated_at: new Date()
        }
      });
    }

    // Store Idempotency
    await prisma.idempotencyKey.create({
      data: { event_key: eventId, source: 'linear' }
    }).catch(() => {});

  } catch (error) {
    logger.error({ error, linearId, eventId }, 'Failed to sync Linear issue to Odoo');
    await prisma.syncLog.create({
      data: {
        event_type: 'Issue',
        source: 'linear',
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        correlation_id: eventId
      }
    });
    throw error;
  }

  // Log Sync
  await prisma.syncLog.create({
    data: {
      event_type: 'Issue',
      source: 'linear',
      status: 'success',
      correlation_id: eventId
    }
  });
}

/**
 * Sync Linear comments to Odoo
 * Only syncs comments that haven't been synced before (append-only)
 */
async function syncLinearCommentsToOdoo(
  linearId: string,
  odooId: number,
  comments: any[],
  ticketMappingId: number
) {
  for (const comment of comments) {
    const existing = await prisma.commentMapping.findUnique({
      where: { linear_comment_id: comment.id }
    });

    if (existing) {
      logger.debug({ commentId: comment.id }, 'Comment already synced, skipping');
      continue;
    }

    try {
      const htmlBody = convertMarkdownToHtml(comment.body);
      const messageId = await odooClient.postMessage(odooId, htmlBody, 'mt_comment');

      await prisma.commentMapping.create({
        data: {
          linear_comment_id: comment.id,
          odoo_message_id: messageId,
          ticket_mapping_id: ticketMappingId,
        }
      });

      logger.debug({ commentId: comment.id }, 'Comment synced to Odoo');
    } catch (err) {
      logger.error({ err, commentId: comment.id }, 'Failed to sync Linear comment to Odoo');
    }
  }
}
