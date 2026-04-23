import { LinearClient } from '@linear/sdk';
import { env } from '../config/env';

export const linearClient = new LinearClient({
  apiKey: env.LINEAR_API_KEY
});

/**
 * Extended helper methods for LinearClient
 * These wrap @linear/sdk for cleaner sync logic
 */

/**
 * Create a comment on a Linear issue
 */
export async function createIssueComment(issueId: string, body: string) {
  return linearClient.commentCreate({
    issueId,
    body,
  });
}

/**
 * Get all comments for a Linear issue
 */
export async function getIssueComments(issueId: string) {
  const issue = await linearClient.issue(issueId, {
    comments: {
      first: 100, // Pagination: fetch first 100 comments
    },
  });

  if (!issue?.comments?.nodes) return [];
  return issue.comments.nodes;
}

/**
 * Update a Linear issue assignee
 */
export async function updateIssueAssignee(issueId: string, userId: string | null) {
  return linearClient.updateIssue(issueId, {
    assigneeId: userId,
  });
}

/**
 * Set labels on a Linear issue (replaces all existing labels)
 */
export async function setIssueLabels(issueId: string, labelIds: string[]) {
  return linearClient.updateIssue(issueId, {
    labelIds,
  });
}

/**
 * Add a single label to a Linear issue
 */
export async function addIssueLabel(issueId: string, labelId: string) {
  const issue = await linearClient.issue(issueId, {
    labels: { first: 100 },
  });

  if (!issue) throw new Error(`Issue ${issueId} not found`);

  const currentLabelIds = issue.labels?.nodes?.map((l: any) => l.id) || [];
  const newLabelIds = [...new Set([...currentLabelIds, labelId])];

  return setIssueLabels(issueId, newLabelIds);
}

/**
 * Remove a single label from a Linear issue
 */
export async function removeIssueLabel(issueId: string, labelId: string) {
  const issue = await linearClient.issue(issueId, {
    labels: { first: 100 },
  });

  if (!issue) throw new Error(`Issue ${issueId} not found`);

  const currentLabelIds = issue.labels?.nodes?.map((l: any) => l.id) || [];
  const newLabelIds = currentLabelIds.filter((id: string) => id !== labelId);

  return setIssueLabels(issueId, newLabelIds);
}

/**
 * Get all labels for a Linear issue
 */
export async function getIssueLabels(issueId: string) {
  const issue = await linearClient.issue(issueId, {
    labels: { first: 100 },
  });

  if (!issue?.labels?.nodes) return [];
  return issue.labels.nodes;
}

/**
 * Search for a user by email in Linear
 */
export async function findLinearUserByEmail(email: string) {
  // Note: Linear doesn't have a direct email search, so we'd need to fetch team members
  // For now, return null - sync logic should handle this gracefully
  // TODO: Implement if Linear SDK supports team member search
  return null;
}

