/**
 * Reading an execution's worktree for the viewer (docs/homes-build.md,
 * P2.4): its tree, one file, its diff, git status, diff stats, and work in
 * progress in the agent's own folder. Filesystem and git only, no database,
 * so a connected device's worker answers these for the executions placed
 * there, with the same shapes the home's routes give for its own.
 */

import { openWorktreeHandle } from './index';
import { listTree } from './list-tree';
import { FileReadError, readBaseFile, readWorkspaceFile } from './read-file';
import { fileErrorAnswer } from './file-http';
import { readWorktreeDiffStats } from './diff-stats';
import { detectSourceWip } from './wip';
import { workingState } from '@/lib/transfer/git-checkpoint';
import { readBranchSync, type BranchSync } from './branch-sync';

/** Where an execution's files are on the device answering. */
export interface ExecutionLocation {
  worktreePath: string;
  /** The agent's own folder on that device. */
  source: string;
  isGit: boolean;
  baseBranch: string | null;
  /** The agent's remote (`origin` unless it says otherwise), for a session in the folder itself. */
  remoteName?: string | null;
  baseSha: string | null;
  filesToCopy: string[];
}

/** The agent's folder there, as `openWorktreeHandle` needs it to open a session in it. */
export function sourceOf(location: ExecutionLocation): { cwd: string; baseBranch: string | null; remoteName: string | null } {
  return { cwd: location.source, baseBranch: location.baseBranch, remoteName: location.remoteName ?? null };
}

export type ExecutionRead =
  | { kind: 'tree' }
  | { kind: 'file'; path: string; base: boolean }
  | { kind: 'diff'; file: string | null }
  | { kind: 'status' }
  | { kind: 'diff_stats' }
  | { kind: 'wip' }
  /** What a checkpoint would take, and what stays behind (P4.2). */
  | { kind: 'working_state' };

/** An answer as the route gives it: its HTTP status and JSON body. */
export interface ReadAnswer {
  status: number;
  body: unknown;
}

const ok = (body: unknown): ReadAnswer => ({ status: 200, body });

export async function readExecution(location: ExecutionLocation, read: ExecutionRead): Promise<ReadAnswer> {
  const pointer = { worktreePath: location.worktreePath, baseSha: location.baseSha };
  switch (read.kind) {
    case 'tree': {
      const handle = await openWorktreeHandle(pointer, sourceOf(location));
      if (!handle) return ok({ entries: [] });
      return ok({ entries: await listTree(handle, location.filesToCopy) });
    }
    case 'file': {
      const handle = await openWorktreeHandle(pointer, sourceOf(location));
      if (!handle) return { status: 404, body: { error: 'Worktree unavailable' } };
      try {
        if (read.base) {
          const content = await readBaseFile(handle, read.path);
          return ok({ path: read.path, content, encoding: 'utf8', mime: 'text/plain', size: content.length, isBinary: false });
        }
        return ok(await readWorkspaceFile(handle, read.path));
      } catch (err) {
        if (err instanceof FileReadError) return fileErrorAnswer(err)!;
        throw err;
      }
    }
    case 'diff': {
      const handle = await openWorktreeHandle(pointer, sourceOf(location));
      if (!handle || handle.kind !== 'git') return ok(null);
      const diff = await handle.git.diff('base');
      return ok(read.file ? { files: diff.files.filter((f) => f.path === read.file) } : diff);
    }
    case 'status': {
      const handle = await openWorktreeHandle(pointer, sourceOf(location));
      if (!handle || handle.kind !== 'git') return ok(null);
      return ok(await readGitStatus(handle, location.worktreePath, sourceOf(location)));
    }
    case 'diff_stats': {
      if (!location.isGit) return ok(null);
      return ok(
        await readWorktreeDiffStats({
          worktreePath: location.worktreePath,
          baseBranch: location.baseBranch,
          baseSha: location.baseSha,
          inPlace: location.worktreePath === location.source,
        }),
      );
    }
    case 'wip': {
      if (!location.isGit || location.worktreePath === location.source) return ok(null);
      return ok(await detectSourceWip(location.source, location.filesToCopy));
    }
    case 'working_state': {
      if (!location.isGit) return ok(null);
      return ok(await workingState(location.worktreePath, location.filesToCopy));
    }
  }
}

/**
 * A worktree's git status with its `BranchSync` alongside, the shape
 * `GET /sessions/:id/status` answers here and on a connected device.
 */
export async function readGitStatus<S extends object>(
  handle: { git: { status(): Promise<S> } },
  worktreePath: string,
  source: { baseBranch: string | null; remoteName: string | null },
): Promise<S & { sync: BranchSync }> {
  const [status, sync] = await Promise.all([handle.git.status(), readBranchSync(worktreePath, source)]);
  return { ...status, sync };
}
