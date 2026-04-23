import { LinearClient, type Comment } from '@linear/sdk';
import { env } from '../config/env';

export const linearClient = new LinearClient({
  apiKey: env.LINEAR_API_KEY,
});

/**
 * Thin wrappers around @linear/sdk so the sync modules don't have to deal with
 * the two-step fetch-parent-then-paginate-children pattern the SDK switched
 * to in v82 (sub-resources like issue.comments are now async fetchers rather
 * than pre-loaded fields).
 */

/** Create a comment on a Linear issue. */
export async function createIssueComment(issueId: string, body: string) {
  return linearClient.createComment({ issueId, body });
}

/**
 * Fetch up to 100 comments for a Linear issue.
 *
 * Two round-trips in v82: fetch the issue, then fetch its comments connection.
 * Returns an empty array instead of throwing if the issue has no comments so
 * callers can treat the result uniformly.
 */
export async function getIssueComments(issueId: string): Promise<Comment[]> {
  const issue = await linearClient.issue(issueId);
  const connection = await issue.comments({ first: 100 });
  return connection.nodes ?? [];
}

/** Set the assignee on a Linear issue (pass `null` to unassign). */
export async function updateIssueAssignee(issueId: string, userId: string | null) {
  return linearClient.updateIssue(issueId, { assigneeId: userId });
}

/** Replace the full label set on a Linear issue. */
export async function setIssueLabels(issueId: string, labelIds: string[]) {
  return linearClient.updateIssue(issueId, { labelIds });
}
