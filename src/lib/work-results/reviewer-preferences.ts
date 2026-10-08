import { getChatSession, getExecution, getWorkspace } from '@/lib/db/queries';
import type { WorkResultDetail, WorkspaceRecord } from '@/db/types';

/** Association is established by the owned producing context, never a linked task. */
export function getWorkResultSourceWorkspace(
  userId: string, sourceChatSessionId?: string | null, sourceExecutionId?: string | null,
): WorkspaceRecord | null {
  const session = sourceChatSessionId ? getChatSession(sourceChatSessionId) : null;
  if (session && (session.userId !== userId || session.surfaceKind === 'result_review')) return null;
  if (session?.executionId && sourceExecutionId && session.executionId !== sourceExecutionId) return null;
  const executionId = sourceExecutionId ?? session?.executionId;
  const execution = executionId ? getExecution(executionId) : null;
  if (execution && execution.userId !== userId) return null;
  if (session?.workspaceId && execution?.workspaceId && session.workspaceId !== execution.workspaceId) return null;
  const workspaceId = execution?.workspaceId ?? session?.workspaceId;
  return workspaceId ? getWorkspace(workspaceId) ?? null : null;
}

export function getAssociatedWorkResultWorkspace(detail: WorkResultDetail): WorkspaceRecord | null {
  return getWorkResultSourceWorkspace(detail.result.userId, detail.result.sourceChatSessionId, detail.result.sourceExecutionId);
}
