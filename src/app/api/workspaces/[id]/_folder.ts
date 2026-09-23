/**
 * Read an agent's own folder for the agent view's Files tab
 * (docs/agents-view-spec.md Phase 5). Lives outside the `route.ts` files
 * because Next.js's app router rejects exports that aren't HTTP method
 * handlers or segment configs.
 *
 * For a git agent this is the source checkout, opened with its current
 * branch at HEAD as the base, so status flags mean uncommitted changes
 * (`openFolderHandle`). Non-git folders open as bare handles. A checkout on
 * a detached HEAD cannot be opened as a handle, so it gets a plain listing
 * without flags and direct reads. Read-only in this spec: nothing here
 * writes.
 */

import type { Workspace } from '@agentex/workspace';
import type { WorkspaceRecord } from '@/db/types';
import type { TreeEntry } from '@/lib/api/sessions';
import { getWorkspace } from '@/lib/db/queries';
import { openFolderHandle } from '@/lib/workspaces';
import { listTree } from '@/lib/workspaces/list-tree';
import { readBaseFile, readWorkspaceFile } from '@/lib/workspaces/read-file';
import { listReferenceTree } from '@/lib/reference-folders/tree';
import { isExistingDir } from '@/lib/terminal/owner';

export interface AgentFolder {
  ws: WorkspaceRecord;
  /** Null for a detached HEAD, see the module doc. */
  handle: Workspace | null;
}

export type FolderResolution = { ok: true; folder: AgentFolder } | { ok: false; response: Response };

export async function openWorkspaceFolder(id: string): Promise<FolderResolution> {
  const ws = getWorkspace(id);
  if (!ws) {
    return { ok: false, response: Response.json({ error: 'Workspace not found' }, { status: 404 }) };
  }
  if (!isExistingDir(ws.cwd)) {
    return {
      ok: false,
      response: Response.json({ error: `The agent's folder does not exist: ${ws.cwd}` }, { status: 409 }),
    };
  }
  return { ok: true, folder: { ws, handle: await openFolderHandle(ws.cwd) } };
}

export async function listFolderTree({ ws, handle }: AgentFolder): Promise<TreeEntry[]> {
  if (handle) return listTree(handle, ws.filesToCopy ?? []);
  return (await listReferenceTree(ws.cwd)).entries;
}

/** Same shape as the session file route. The base side is empty without a handle. */
export async function readFolderFile({ ws, handle }: AgentFolder, relPath: string, wantBase: boolean): Promise<Response> {
  if (wantBase) {
    const content = handle ? await readBaseFile(handle, relPath) : '';
    return Response.json({ path: relPath, content, encoding: 'utf8', mime: 'text/plain', size: content.length, isBinary: false });
  }
  return Response.json(await readWorkspaceFile({ path: ws.cwd }, relPath));
}
