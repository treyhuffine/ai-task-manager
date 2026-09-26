/**
 * Reading an execution's worktree for the viewer (docs/homes-build.md,
 * P2.4): its tree, one file, its diff, git status, diff stats, and work in
 * progress in the agent's own folder. Filesystem and git only, no database,
 * so a connected computer's worker answers these for the executions placed
 * there, with the same shapes the home's routes give for its own.
 */

import { openWorktreeHandle } from './index';
import { listTree } from './list-tree';
import { FileReadError, readBaseFile, readWorkspaceFile } from './read-file';
import { fileErrorAnswer } from './file-http';
import { readWorktreeDiffStats } from './diff-stats';
import { detectSourceWip } from './wip';

/** Where an execution's files are on the computer answering. */
export interface ExecutionLocation {
  worktreePath: string;
  /** The agent's own folder on that computer. */
  source: string;
  isGit: boolean;
  baseBranch: string | null;
  baseSha: string | null;
  filesToCopy: string[];
}

export type ExecutionRead =
  | { kind: 'tree' }
  | { kind: 'file'; path: string; base: boolean }
  | { kind: 'diff'; file: string | null }
  | { kind: 'status' }
  | { kind: 'diff_stats' }
  | { kind: 'wip' };

/** An answer as the route gives it: its HTTP status and JSON body. */
export interface ReadAnswer {
  status: number;
  body: unknown;
}

const ok = (body: unknown): ReadAnswer => ({ status: 200, body });

export async function readExecution(location: ExecutionLocation, read: ExecutionRead): Promise<ReadAnswer> {
  const pointer = { worktreePath: location.worktreePath };
  switch (read.kind) {
    case 'tree': {
      const handle = await openWorktreeHandle(pointer, location.source);
      if (!handle) return ok({ entries: [] });
      return ok({ entries: await listTree(handle, location.filesToCopy) });
    }
    case 'file': {
      const handle = await openWorktreeHandle(pointer, location.source);
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
      const handle = await openWorktreeHandle(pointer, location.source);
      if (!handle || handle.kind !== 'git') return ok(null);
      const diff = await handle.git.diff('base');
      return ok(read.file ? { files: diff.files.filter((f) => f.path === read.file) } : diff);
    }
    case 'status': {
      const handle = await openWorktreeHandle(pointer, location.source);
      if (!handle || handle.kind !== 'git') return ok(null);
      return ok(await handle.git.status());
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
  }
}
