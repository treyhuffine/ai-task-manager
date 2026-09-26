/**
 * HTTP answers for the file viewer, shared by every surface that shows a
 * folder: an execution's worktree (`/api/sessions/:id/file`) and an agent's
 * own folder (`/api/workspaces/:id/file`). Routes open the handle, these
 * read and map errors, so both surfaces answer with identical shapes and the
 * viewer only swaps its base URL.
 */

import type { Workspace } from '@agentex/workspace';
import { FileReadError, readBaseFile, readWorkspaceFile } from './read-file';
import { FileWriteError } from './write-file';

/**
 * Read one file. `wantBase` returns the diff "old" side (the content at the
 * base commit, empty for non-git folders).
 */
export async function fileReadResponse(handle: Workspace, relPath: string, wantBase: boolean): Promise<Response> {
  if (wantBase) {
    const content = await readBaseFile(handle, relPath);
    return Response.json({
      path: relPath,
      content,
      encoding: 'utf8',
      mime: 'text/plain',
      size: content.length,
      isBinary: false,
    });
  }
  return Response.json(await readWorkspaceFile(handle, relPath));
}

/**
 * Convert a thrown FileReadError/FileWriteError into the right HTTP
 * status. Anything else falls through to a 500 with the message logged
 * — those are bugs, not user-correctable failures.
 */
export function mapFileError(err: unknown, logTag: string): Response {
  const answer = fileErrorAnswer(err);
  if (answer) return Response.json(answer.body, { status: answer.status });
  console.error(logTag, err);
  return Response.json({ error: String(err) }, { status: 500 });
}

/**
 * The status and body for a FileReadError or FileWriteError, as data, or
 * null for anything else. Shared with a worker's answers for an execution
 * elsewhere, so a refused change reads the same wherever it ran.
 */
export function fileErrorAnswer(err: unknown): { status: number; body: { error: string; code: string } } | null {
  if (err instanceof FileReadError) {
    const status =
      err.code === 'not_found' ? 404 :
      err.code === 'invalid_path' ? 400 :
      err.code === 'is_directory' ? 400 : 500;
    return { status, body: { error: err.message, code: err.code } };
  }
  if (err instanceof FileWriteError) {
    const status =
      err.code === 'invalid_path' ? 400 :
      err.code === 'is_directory' ? 400 :
      err.code === 'is_file' ? 400 :
      err.code === 'exists' ? 409 :
      err.code === 'too_large' ? 413 :
      err.code === 'not_found' ? 404 : 500;
    return { status, body: { error: err.message, code: err.code } };
  }
  return null;
}
