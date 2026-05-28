/**
 * Helpers shared by the mutating routes under `/api/sessions/[id]/...`
 * (file, file/rename, dir). Lives outside the `route.ts` files because
 * Next.js's app router rejects exports that aren't HTTP method handlers
 * or one of the documented runtime/segment configs.
 */

import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';
import { FileReadError } from '@/lib/workspaces/read-file';
import { FileWriteError } from '@/lib/workspaces/write-file';
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

/**
 * Convert a thrown FileReadError/FileWriteError into the right HTTP
 * status. Anything else falls through to a 500 with the message logged
 * — those are bugs, not user-correctable failures.
 */
export function mapFileError(err: unknown, logTag: string): Response {
  if (err instanceof FileReadError) {
    const status =
      err.code === 'not_found' ? 404 :
      err.code === 'invalid_path' ? 400 :
      err.code === 'is_directory' ? 400 : 500;
    return Response.json({ error: err.message, code: err.code }, { status });
  }
  if (err instanceof FileWriteError) {
    const status =
      err.code === 'invalid_path' ? 400 :
      err.code === 'is_directory' ? 400 :
      err.code === 'is_file' ? 400 :
      err.code === 'exists' ? 409 :
      err.code === 'too_large' ? 413 :
      err.code === 'not_found' ? 404 : 500;
    return Response.json({ error: err.message, code: err.code }, { status });
  }
  console.error(logTag, err);
  return Response.json({ error: String(err) }, { status: 500 });
}
