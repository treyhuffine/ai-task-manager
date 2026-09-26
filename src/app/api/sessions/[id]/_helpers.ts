/**
 * Helpers shared by the mutating routes under `/api/sessions/[id]/...`
 * (file, file/rename, dir). Lives outside the `route.ts` files because
 * Next.js's app router rejects exports that aren't HTTP method handlers
 * or one of the documented runtime/segment configs.
 */

import { chatPlacement, getChatSessionWithExecution, getComputer, getWorkspace } from '@/lib/db/queries';
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
 *
 * Only for an execution that runs here. One elsewhere has its folder on
 * that computer, and the same path on this disk could be a different
 * folder, so it's refused: its routes ask its computer (`writeOnOwner`).
 */
export async function openSessionWorktree(id: string): Promise<WorktreeResolution> {
  const session = getChatSessionWithExecution(id);
  if (!session) {
    return { ok: false, response: Response.json({ error: 'Session not found' }, { status: 404 }) };
  }
  const placement = chatPlacement(id);
  if (placement && !placement.isHome) {
    const name = getComputer(placement.computerId)?.name ?? 'another computer';
    return {
      ok: false,
      response: Response.json({ error: 'elsewhere', message: `This execution's files are on ${name}.` }, { status: 409 }),
    };
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
