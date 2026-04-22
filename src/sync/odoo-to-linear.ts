import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { convertHtmlToMarkdown } from '../utils/rich-text';
import {
  linearClient,
  updateIssueAssignee,
  setIssueLabels,
  createIssueComment,
} from '../adapters/linear-client';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { ODOO_STAGE_MAP } from '../config/odoo-stage-mapping';
import { TAG_MAP_REVERSE } from '../config/tag-mapping';
import { odooClient } from '../adapters/odoo-client';
import { getStageName, getTagName } from '../config/odoo-metadata-cache';
import { LINEAR_STATE_IDS } from '../config/linear-state-ids';
import { LINEAR_LABEL_IDS } from '../config/linear-label-ids';

const prisma = new PrismaClient();

function calculateChecksum(ticket: any, messageCount: number = 0): string {
  const title = ticket.name || '';
  const description = ticket.description || '';
  const statusStr = ticket.stage_id ? String(ticket.stage_id[0]) : 'Unknown';
  const assigneeId = ticket.user_id ? String(ticket.user_id[0]) : '';
  const tagIds = (ticket.tag_ids || []).sort().join(',');

  const checksumString = `${title}|${description}|${statusStr}|${assigneeId}|${tagIds}|${messageCount}`;
  return crypto.createHash('sha256').update(checksumString).digest('hex');
}

export async function processOdooToLinear(data: any) {
  const { ticket } = data;
  const odooId = ticket.id;

  logger.info({ odooId, ticketName: ticket.name, stageId: ticket.stage_id }, 'Processing Odoo ticket → Linear');

  // Layer 1: Idempotency Key
  const eventId = `odoo-ticket-${odooId}-${ticket.write_date}`;

  const idempotencyExists = await prisma.idempotencyKey.findUnique({
    where: { event_key: eventId }
  });

  if (idempotencyExists) {
    logger.info({ odooId, eventId }, 'Skipping: event already processed (idempotency key exists)');
    return;
  }

  logger.info({ odooId, eventId }, 'Idempotency check passed — proceeding with sync');

  const title = ticket.name || '';
  const htmlDescription = ticket.description || '';
  const markdownDescription = convertHtmlToMarkdown(htmlDescription);

  // Fetch messages for checksum
  const messages = await odooClient
    .getTicketMessages(odooId)
    .then((msgs) => msgs.filter((m: any) => m.message_type === 'comment'))
    .catch(() => []);

  // Layer 3: Enhanced Checksum
  const checksum = calculateChecksum(ticket, messages.length);

  let mapping = await prisma.ticketMapping.findUnique({
    where: { odoo_id: odooId }
  });

  logger.info({ odooId, existingMapping: mapping ? `linear_id=${mapping.linear_id}` : 'none' }, 'Ticket mapping lookup complete');

  try {
    if (!mapping) {
      // Create in Linear
      logger.info({ odooId }, 'No existing mapping — creating new issue in Linear');

      const odooStageId = ticket.stage_id ? ticket.stage_id[0] : null;
      const odooStageName = odooStageId ? getStageName(odooStageId) : null;
      const linearStateName = odooStageName ? ODOO_STAGE_MAP[odooStageName] : null;

      if (odooStageId && !odooStageName) {
        logger.warn({ odooStageId }, 'Odoo stage ID not found in cache');
      } else if (odooStageName && !linearStateName) {
        logger.warn({ odooStageName }, 'Odoo stage name not in ODOO_STAGE_MAP');
      }

      // Resolve Linear state UUID from name — stateId is the correct Linear SDK field
      const resolvedStateName = linearStateName ?? 'Todo';
      const linearStateId = LINEAR_STATE_IDS[resolvedStateName];
      if (!linearStateId) {
        logger.warn({ resolvedStateName }, 'No Linear state ID found for state name');
      }

      const payload: any = {
        teamId: env.LINEAR_TEAM_ID,
        title,
        description: markdownDescription,
        ...(linearStateId ? { stateId: linearStateId } : {}),
      };

      logger.info({ odooId, payload }, 'Sending create issue request to Linear API');
      const issuePayload = await linearClient.createIssue(payload);
      const linearIssue = await issuePayload.issue;
      logger.info({ odooId, linearIssueId: linearIssue?.id }, 'Linear API response received for issue creation');

      if (!linearIssue) throw new Error('Failed to create Linear issue');

      mapping = await prisma.ticketMapping.create({
        data: {
          linear_id: linearIssue.id,
          odoo_id: odooId,
          last_synced_at: new Date(),
          last_checksum: checksum,
          sync_direction: 'odoo-to-linear'
        }
      });

      // Sync assignee
      if (ticket.user_id && ticket.user_id[0]) {
        const odooUser = await odooClient.getUser(ticket.user_id[0]);
        if (odooUser?.email) {
          const userMapping = await prisma.userMapping.findUnique({
            where: { odoo_email: odooUser.email }
          });
          if (userMapping?.linear_user_id) {
            await updateIssueAssignee(linearIssue.id, userMapping.linear_user_id).catch((err) =>
              logger.warn({ err }, 'Failed to set assignee on Linear issue')
            );
          } else {
            logger.warn({ odooEmail: odooUser.email }, 'No user mapping found for Odoo user');
          }
        }
      }

      // Sync tags as Linear labels
      if (ticket.tag_ids && ticket.tag_ids.length > 0) {
        const labelIds = ticket.tag_ids
          .map((tagId: number) => {
            const odooTagName = getTagName(tagId);
            if (!odooTagName) {
              logger.warn({ tagId }, 'Odoo tag ID not found in cache');
              return null;
            }
            const linearLabelName = TAG_MAP_REVERSE[odooTagName];
            if (!linearLabelName) {
              logger.debug({ odooTagName }, 'Odoo tag not in TAG_MAP_REVERSE, skipping');
              return null;
            }
            const labelId = LINEAR_LABEL_IDS[linearLabelName];
            if (!labelId) {
              logger.warn({ linearLabelName }, 'No Linear label ID found for label name');
              return null;
            }
            return labelId;
          })
          .filter((id: string | null) => id !== null);

        if (labelIds.length > 0) {
          await setIssueLabels(linearIssue.id, labelIds).catch((err) =>
            logger.warn({ err }, 'Failed to sync labels to Linear')
          );
        }
      }

      // Sync comments (append-only)
      await syncOdooCommentsToLinear(odooId, linearIssue.id, messages, mapping.id);
    } else {
      // Update in Linear
      if (mapping.last_checksum === checksum) {
        logger.info({ odooId, linearId: mapping.linear_id }, 'Skipping: checksum unchanged, ticket not modified since last sync');
        await prisma.idempotencyKey.create({
          data: { event_key: eventId, source: 'odoo' }
        }).catch(() => {});
        return;
      }

      const odooWriteDate = new Date(ticket.write_date);
      const linearWins = mapping.updated_at > odooWriteDate;

      logger.info({ odooId, linearWins, odooWriteDate, mappingUpdatedAt: mapping.updated_at }, 'Conflict resolution check');
      if (linearWins) {
        logger.info({ odooId }, 'Skipping: Linear wins conflict resolution (Linear was updated more recently)');
        await prisma.ticketMapping.update({
          where: { id: mapping.id },
          data: {
            last_synced_at: new Date(),
            updated_at: new Date()
          }
        });
      } else {
        logger.info({ odooId, linearId: mapping.linear_id }, 'Updating issue in Linear (Odoo wins conflict resolution)');

        const odooStageId = ticket.stage_id ? ticket.stage_id[0] : null;
        const odooStageName = odooStageId ? getStageName(odooStageId) : null;
        const linearStateName = odooStageName ? ODOO_STAGE_MAP[odooStageName] : null;

        const resolvedStateName = linearStateName ?? 'Todo';
        const linearStateId = LINEAR_STATE_IDS[resolvedStateName];
        if (!linearStateId) {
          logger.warn({ resolvedStateName }, 'No Linear state ID found for state name');
        }

        logger.info({ linearId: mapping.linear_id, stateId: linearStateId }, 'Sending update issue request to Linear API');
        await linearClient.updateIssue(mapping.linear_id, {
          title,
          description: markdownDescription,
          ...(linearStateId ? { stateId: linearStateId } : {}),
        });
        logger.info({ linearId: mapping.linear_id }, 'Linear API update response received');

        // Update assignee
        if (ticket.user_id && ticket.user_id[0]) {
          const odooUser = await odooClient.getUser(ticket.user_id[0]);
          if (odooUser?.email) {
            const userMapping = await prisma.userMapping.findUnique({
              where: { odoo_email: odooUser.email }
            });
            if (userMapping?.linear_user_id) {
              await updateIssueAssignee(mapping.linear_id, userMapping.linear_user_id).catch((err) =>
                logger.warn({ err }, 'Failed to update assignee on Linear issue')
              );
            }
          }
        } else {
          await updateIssueAssignee(mapping.linear_id, null).catch(() => {});
        }

        // Update tags as Linear labels
        if (ticket.tag_ids) {
          const labelIds = ticket.tag_ids
            .map((tagId: number) => {
              const odooTagName = getTagName(tagId);
              if (!odooTagName) {
                logger.warn({ tagId }, 'Odoo tag ID not found in cache');
                return null;
              }
              const linearLabelName = TAG_MAP_REVERSE[odooTagName];
              if (!linearLabelName) {
                logger.debug({ odooTagName }, 'Odoo tag not in TAG_MAP_REVERSE, skipping');
                return null;
              }
              const labelId = LINEAR_LABEL_IDS[linearLabelName];
              if (!labelId) {
                logger.warn({ linearLabelName }, 'No Linear label ID found for label name');
                return null;
              }
              return labelId;
            })
            .filter((id: string | null) => id !== null);

          await setIssueLabels(mapping.linear_id, labelIds).catch((err) =>
            logger.warn({ err }, 'Failed to update labels on Linear issue')
          );
        }

        // Sync new comments
        await syncOdooCommentsToLinear(odooId, mapping.linear_id, messages, mapping.id);

        await prisma.ticketMapping.update({
          where: { id: mapping.id },
          data: {
            last_synced_at: new Date(),
            last_checksum: checksum,
            updated_at: new Date()
          }
        });
      }
    }

    // Store Idempotency
    await prisma.idempotencyKey.create({
      data: { event_key: eventId, source: 'odoo' }
    }).catch(() => {});
  } catch (error) {
    logger.error({ error, odooId, eventId }, 'Failed to sync Odoo ticket to Linear');
    await prisma.syncLog.create({
      data: {
        event_type: 'Issue',
        source: 'odoo',
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
      source: 'odoo',
      status: 'success',
      correlation_id: eventId
    }
  });
}

async function syncOdooCommentsToLinear(
  odooId: number,
  linearId: string,
  messages: any[],
  ticketMappingId: number
) {
  for (const message of messages) {
    const existing = await prisma.commentMapping.findUnique({
      where: { odoo_message_id: message.id }
    });

    if (existing) {
      logger.debug({ messageId: message.id }, 'Message already synced, skipping');
      continue;
    }

    try {
      const markdownBody = convertHtmlToMarkdown(message.body);
      const commentPayload = await createIssueComment(linearId, markdownBody);

      // commentCreate returns CommentPayload; the actual Comment is lazy-loaded
      const actualComment = await commentPayload.comment;
      if (!actualComment?.id) {
        logger.warn({ messageId: message.id }, 'Linear comment created but ID unavailable, skipping mapping');
        continue;
      }

      await prisma.commentMapping.create({
        data: {
          linear_comment_id: actualComment.id,
          odoo_message_id: message.id,
          ticket_mapping_id: ticketMappingId,
        }
      });

      logger.debug({ messageId: message.id }, 'Message synced to Linear');
    } catch (err) {
      logger.error({ err, messageId: message.id }, 'Failed to sync Odoo message to Linear');
    }
  }
}
