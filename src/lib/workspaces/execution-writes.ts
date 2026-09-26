/**
 * Changing an execution's files from the viewer (docs/homes-build.md, P3.5):
 * save, create, rename, delete, make a folder, resolve a conflict, and bring
 * work in progress over from the agent's folder. Filesystem and git only, no
 * database, so the computer an execution runs on makes these changes in the
 * worktree it prepared, with the same answers the home's routes give for its
 * own. Only these defined operations, each inside the execution's folder:
 * never an arbitrary path (spec §5).
 */

import { openWorktreeHandle } from './index';
import type { ExecutionLocation, ReadAnswer } from './execution-reads';
import { fileErrorAnswer } from './file-http';
import {
  createWorkspaceDir,
  createWorkspaceFile,
  deleteWorkspacePath,
  renameWorkspacePath,
  resolveWorkspaceConflict,
  writeWorkspaceFile,
} from './write-file';
import { copyWipToWorktree, detectSourceWip, moveWipToWorktree } from './wip';

export type ExecutionWrite =
  | { kind: 'write'; path: string; content: string }
  | { kind: 'create_file'; path: string }
  | { kind: 'create_dir'; path: string }
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'delete'; path: string }
  | { kind: 'resolve_conflict'; path: string; content: string }
  | { kind: 'bring_wip'; action: 'copy' | 'move' };

const ok = (body: unknown): ReadAnswer => ({ status: 200, body });

export async function writeExecution(location: ExecutionLocation, write: ExecutionWrite): Promise<ReadAnswer> {
  if (write.kind === 'bring_wip') return bringWip(location, write.action);
  const handle = await openWorktreeHandle({ worktreePath: location.worktreePath }, location.source);
  if (!handle) return { status: 404, body: { error: 'Worktree unavailable' } };
  try {
    switch (write.kind) {
      case 'write':
        return ok({ ok: true, ...(await writeWorkspaceFile(handle, write.path, write.content)) });
      case 'create_file':
        return ok({ ok: true, ...(await createWorkspaceFile(handle, write.path)) });
      case 'create_dir':
        return ok({ ok: true, ...(await createWorkspaceDir(handle, write.path)) });
      case 'rename':
        return ok({ ok: true, ...(await renameWorkspacePath(handle, write.from, write.to)) });
      case 'delete':
        return ok({ ok: true, ...(await deleteWorkspacePath(handle, write.path)) });
      case 'resolve_conflict':
        return ok({ ok: true, ...(await resolveWorkspaceConflict(handle, write.path, write.content)) });
    }
  } catch (err) {
    const answer = fileErrorAnswer(err);
    if (answer) return answer;
    throw err;
  }
}

/**
 * Copy or move the agent folder's uncommitted work into the execution's
 * worktree. The file list is read here, now, never taken from the caller:
 * the folder may have changed since the viewer saw it.
 */
async function bringWip(location: ExecutionLocation, action: 'copy' | 'move'): Promise<ReadAnswer> {
  if (!location.isGit) return { status: 409, body: { error: 'Workspace is not a git workspace' } };
  if (location.worktreePath === location.source) {
    return { status: 409, body: { error: 'Session runs in-place; no worktree handoff needed' } };
  }
  const wip = await detectSourceWip(location.source, location.filesToCopy);
  const files = [...wip.modified, ...wip.untracked];
  if (files.length === 0) return ok({ action, empty: true });
  const args = { sourceCwd: location.source, worktreePath: location.worktreePath, files };
  if (action === 'copy') return ok({ action: 'copy', ...(await copyWipToWorktree(args)) });
  return ok({ action: 'move', ...(await moveWipToWorktree(args)) });
}
