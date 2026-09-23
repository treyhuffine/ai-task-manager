/**
 * Helpers shared by the mutating routes under `/api/sessions/[id]/...`
 * (file, file/rename, dir). Lives outside the `route.ts` files because
 * Next.js's app router rejects exports that aren't HTTP method handlers
 * or one of the documented runtime/segment configs.
 */

import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';
import type { Workspace } from '@agentex/workspace';

export type WorktreeResolution =
  | { ok: true; handle: Workspace }
  | { ok: false; response: Response };

/**
 * Look up the chat session, its workspace, and open the worktree on
 * disk. Returns either an open `Workspace` handle or a Response the
 * caller should return as-is. Centralises the four-step nullability
 * check every mutating handler would otherwise repeat.
 */
export async function openSessionWorktree(id: string): Promise<WorktreeResolution> {
  const session = getChatSessionWithExecution(id);
  if (!session) {
    return { ok: false, response: Response.json({ error: 'Session not found' }, { status: 404 }) };
  }
  if (!session.workspaceId || !session.worktreePath) {
    return {
      ok: false,
      response: Response.json({ error: 'Workspace has no worktree' }, { status: 404 }),
    };
  }
  const ws = getWorkspace(session.workspaceId);
  if (!ws) {
    return {
      ok: false,
      response: Response.json({ error: 'Workspace not found' }, { status: 404 }),
    };
  }
  const handle = await openWorktreeHandle(session, ws.cwd);
  if (!handle) {
    return {
      ok: false,
      response: Response.json({ error: 'Worktree unavailable' }, { status: 404 }),
    };
  }
  return { ok: true, handle };
}

/** Moved to lib so the agent's folder routes share it. */
export { mapFileError } from '@/lib/workspaces/file-http';
