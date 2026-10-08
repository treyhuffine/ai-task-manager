/**
 * Files outside a chat's folder that its file viewer opens anyway.
 *
 * The transcript shows every file an agent reads or writes with a file tool
 * (Read, Write, Edit, apply_patch, …) as a chip, and a chip has to open what
 * it names. Often that is outside the worktree: a screenshot the agent took
 * in /tmp and then looked at. The viewer reads those files, and only those:
 *   - inside the chat's folder, as always (`readWorkspaceFile`);
 *   - outside it, when a file tool call in this chat, or in another chat on
 *     its execution, named that exact absolute path
 *     (`fileToolCallNamed` in `src/lib/db/queries.ts`).
 * Showing you a file your agent already read gives the browser nothing the
 * agent couldn't already say, and nothing else on the disk is reachable.
 * They open read only: saving outside the folder is not the viewer's job.
 *
 * The same rule as images in replies (`reply-images.ts`), there by what the
 * agent wrote, here by what its tools touched.
 */

import path from 'node:path';

/** Where a requested viewer path is: in the chat's folder, or outside it. */
export type PlacedPath =
  | { kind: 'folder'; path: string }
  | { kind: 'outside'; file: string };

/**
 * Relative paths stay in the folder (the reader refuses traversal). An
 * absolute path under the folder becomes relative to it, and any other
 * absolute path is outside, normalized so `/a/../b` is judged as `/b`.
 */
export function placeViewerPath(requested: string, folder: string | null): PlacedPath {
  if (!path.isAbsolute(requested)) return { kind: 'folder', path: requested };
  const file = path.normalize(requested);
  if (folder) {
    const rel = path.relative(path.normalize(folder), file);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return { kind: 'folder', path: rel };
  }
  return { kind: 'outside', file };
}

export const NOT_NAMED_MESSAGE = "Only files in this chat's folder, or ones its agent read or wrote, open here.";
