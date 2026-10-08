import { chatPlacement, getHome, placementOf } from '@/lib/db/queries';
import type { ChatSessionWithExecution, ExecutionRecord, WorkspaceRecord } from '@/db/types';

/** A foreign device's recorded path must never be opened on the home. */
export function localWorkResultSourceFolder(session: ChatSessionWithExecution | null | undefined, execution: ExecutionRecord | null | undefined, workspace: WorkspaceRecord | null | undefined): string | null {
  if (session && chatPlacement(session.id)?.isHome === false) return null;
  if (execution) {
    const placement = placementOf(execution.id);
    if (placement && placement.deviceId !== getHome()?.hostDeviceId) return null;
    return placement?.worktreePath ?? execution.worktreePath;
  }
  return session?.worktreePath ?? (session?.executionId ? null : workspace?.cwd ?? null);
}
