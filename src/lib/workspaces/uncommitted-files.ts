/**
 * What archiving an execution would delete. Archive removes the worktree
 * but keeps its branch, so committed work survives (pushed or not) and
 * only files git doesn't have yet are lost. Pure, so the archive route,
 * the worker and the client all describe them the same way.
 */

export interface UncommittedFile {
  /** Worktree-relative. An untracked folder git reports whole ends in `/`. */
  path: string;
  /**
   * `untracked`: git has never had it, so the whole file goes.
   * `changed`: edits (or a delete) made since the last commit go.
   */
  change: 'untracked' | 'changed';
}

/** The file lists of agentex's `WorkspaceStatus`, which is all this reads. */
export interface WorktreeFileStatus {
  untracked: readonly string[];
  modified: readonly string[];
  staged: readonly string[];
}

/** One entry per path, sorted by path. A file both staged and edited is one change. */
export function listUncommittedFiles(status: WorktreeFileStatus): UncommittedFile[] {
  const changed = new Set([...status.modified, ...status.staged]);
  const files: UncommittedFile[] = [
    ...[...changed].map((path) => ({ path, change: 'changed' as const })),
    ...status.untracked.filter((path) => !changed.has(path)).map((path) => ({ path, change: 'untracked' as const })),
  ];
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Most files a refusal lists. Past it, it counts the rest: a folder git
 * ignores nowhere (a stray build output) can hold tens of thousands, and
 * the list crosses the wire to a phone, or from another device.
 */
export const MAX_LISTED_FILES = 500;

/** The files a refusal lists, and how many more it left out. */
export interface UncommittedList {
  files: UncommittedFile[];
  omitted: number;
}

/**
 * The archive route's 409 when the worktree holds work that isn't
 * committed. `files` is null when the list couldn't be read (a device
 * running an older worker), so the client can still say what's at stake.
 */
export interface DirtyWorktreeBody {
  error: 'DirtyWorktreeError';
  code: 'dirty_worktree';
  message: string;
  /** The execution's name, so a list of several can say whose files these are. */
  label: string | null;
  files: UncommittedFile[] | null;
  /** Files past {@link MAX_LISTED_FILES}, not in `files`. */
  omitted: number;
}

/** The list from an error carrying agentex's `status` (its `DirtyWorktreeError`), capped, else null. */
export function uncommittedFilesOf(err: unknown): UncommittedList | null {
  const status = (err as { status?: Partial<WorktreeFileStatus> } | null)?.status;
  if (!status || !Array.isArray(status.untracked) || !Array.isArray(status.modified) || !Array.isArray(status.staged)) {
    return null;
  }
  const files = listUncommittedFiles(status as WorktreeFileStatus);
  return { files: files.slice(0, MAX_LISTED_FILES), omitted: Math.max(0, files.length - MAX_LISTED_FILES) };
}

/**
 * One line naming the files, for an agent reading a refusal:
 * `src/a.ts (changed), notes.md (untracked) and 3 more`.
 */
export function describeUncommittedFiles(files: readonly UncommittedFile[], omitted = 0, max = 20): string {
  const shown = files.slice(0, max).map((f) => `${f.path} (${f.change})`).join(', ');
  const more = Math.max(0, files.length - max) + omitted;
  return more > 0 ? `${shown} and ${more} more` : shown;
}
