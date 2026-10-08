import { getChatSession, getExecution, getWorkspace, getHome, placementOf } from '@/lib/db/queries';
import { requestWorker } from '@/lib/workers/hub';
import type { WorkingState } from '@/lib/transfer/git-checkpoint';
import { openFolderHandle } from '@/lib/workspaces';
import type { WorkResultCodeRevision } from '@/db/types';
import { ActionError } from '@/lib/orchestrator/types';

/** Observe on the execution computer. Never promote a submitted SHA to evidence. */
export async function observeWorkResultCodeRevision(sessionId: string | null | undefined, userId: string): Promise<WorkResultCodeRevision | null> {
  if (!sessionId) return null;
  const session = getChatSession(sessionId);
  if (!session || session.userId !== userId) throw new ActionError('not_found', 'The producing conversation is unavailable.');
  return session.executionId ? observeWorkResultExecutionCodeRevision(session.executionId, userId) : null;
}

/** Retained results can still inspect their execution after transcript pruning. */
export async function observeWorkResultExecutionCodeRevision(executionId: string | null | undefined, userId: string): Promise<WorkResultCodeRevision | null> {
  if (!executionId) return null;
  const execution = getExecution(executionId);
  if (execution && execution.userId !== userId) throw new ActionError('not_found', 'The producing execution is unavailable.');
  const workspace = execution?.workspaceId ? getWorkspace(execution.workspaceId) : null;
  if (!execution || !workspace?.isGit) return null;
  const unknown: WorkResultCodeRevision = { commitSha: null, workingTreeState: 'unknown', capturedAt: new Date().toISOString() };
  const recorded = placementOf(execution.id);
  const placement = recorded ? { ...recorded } : null;
  if (placement && placement.deviceId !== getHome()?.hostDeviceId) {
    try {
      const answer = await requestWorker(placement.deviceId, 'read_execution', {
        executionId: execution.id, workspace: { id: workspace.id, isGit: workspace.isGit,
          baseBranch: workspace.baseBranch, remoteName: workspace.remoteName, filesToCopy: workspace.filesToCopy ?? [] },
        baseSha: execution.baseSha, read: { kind: 'working_state' },
      }) as { status: number; body: WorkingState | null };
      const now = placementOf(execution.id);
      if (now?.deviceId !== placement.deviceId || now.generation !== placement.generation || answer.status !== 200 || !answer.body) return unknown;
      const state = answer.body;
      if (typeof state.head !== 'string' || !Array.isArray(state.changed) || !Array.isArray(state.untracked) || !Array.isArray(state.localOnly)) return unknown;
      return { commitSha: state.head, workingTreeState: state.changed.length || state.untracked.length || state.localOnly.length ? 'dirty' : 'clean', capturedAt: new Date().toISOString() };
    } catch { return unknown; }
  }
  const folder = placement?.worktreePath ?? execution.worktreePath;
  if (!folder) return unknown;
  try {
    const handle = await openFolderHandle(folder);
    if (!handle || handle.kind !== 'git') return unknown;
    const [head, status] = await Promise.all([handle.git.raw(['rev-parse', 'HEAD']), handle.git.status()]);
    return { commitSha: head.stdout.trim(), workingTreeState: status.dirty ? 'dirty' : 'clean', capturedAt: new Date().toISOString() };
  } catch { return unknown; }
}
