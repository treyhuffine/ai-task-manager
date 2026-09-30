/**
 * Work that exists only on this device, before retiring its home
 * (docs/homes-spec.md §10.2, P5.1: "verify ... unpublished work"): for each
 * execution's worktree here, whether it has uncommitted changes or commits
 * no remote has. Importing a home moves no folders, so this work stays where
 * it is and continuing the execution finds it. This says where it is, so
 * nothing is forgotten when the old home is archived.
 *
 * Reads the home's database without writing to its root, and only reads the
 * worktrees (`git status`, `git rev-list`).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { withSourceDatabase } from './source-db';

export interface WorktreeState {
  executionId: string;
  label: string;
  agent: string;
  status: string;
  path: string;
  /** The folder isn't on this device (anymore). */
  missing: boolean;
  branch: string | null;
  /** Files changed or new, not committed. */
  uncommitted: number;
  /** Commits on this branch that no remote has. */
  unpushed: number;
  error: string | null;
}

/**
 * One folder executions ran in: a worktree of its own, or the project's own
 * folder, which every live execution in that project shares.
 */
export interface FolderState {
  path: string;
  /** Inside the home's own folder (its `.work/worktrees`): it moves if that folder moves. */
  insideHome: boolean;
  executions: Array<{ id: string; label: string; agent: string; status: string }>;
  missing: boolean;
  branch: string | null;
  uncommitted: number;
  unpushed: number;
  error: string | null;
}

export interface UnpublishedWorkReport {
  root: string;
  /** Executions with a folder recorded. */
  worktrees: number;
  here: number;
  withWork: WorktreeState[];
  missing: number;
  errors: WorktreeState[];
  /** The same, by folder. */
  folders: FolderState[];
}

type Row = Record<string, unknown>;
const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
    .toString()
    .trim();
}

export function inspectWorktree(folder: string): Pick<WorktreeState, 'missing' | 'branch' | 'uncommitted' | 'unpushed' | 'error'> {
  if (!fs.existsSync(folder)) return { missing: true, branch: null, uncommitted: 0, unpushed: 0, error: null };
  try {
    const status = git(folder, 'status', '--porcelain');
    const branch = git(folder, 'rev-parse', '--abbrev-ref', 'HEAD');
    const unpushed = Number(git(folder, 'rev-list', '--count', 'HEAD', '--not', '--remotes')) || 0;
    return { missing: false, branch: branch === 'HEAD' ? null : branch, uncommitted: status ? status.split('\n').length : 0, unpushed, error: null };
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim();
    return { missing: false, branch: null, uncommitted: 0, unpushed: 0, error: stderr || (err instanceof Error ? err.message : String(err)) };
  }
}

export function unpublishedWork(root: string): UnpublishedWorkReport {
  const rows = withSourceDatabase(path.join(root, 'data.db'), (db) =>
    db
      .prepare(
        `SELECT e.id, e.label, e.status, e.worktree_path, w.name AS agent
         FROM executions e LEFT JOIN workspaces w ON w.id = e.workspace_id
         WHERE e.worktree_path IS NOT NULL AND e.worktree_path <> ''
         ORDER BY e.updated_at DESC`,
      )
      .all() as Row[],
  );
  // Each folder is read once, however many executions share it.
  const inspected = new Map<string, ReturnType<typeof inspectWorktree>>();
  const inspect = (folder: string) => {
    if (!inspected.has(folder)) inspected.set(folder, inspectWorktree(folder));
    return inspected.get(folder)!;
  };
  const states: WorktreeState[] = rows.map((r) => ({
    executionId: text(r.id),
    label: text(r.label) || '(unlabeled)',
    agent: text(r.agent),
    status: text(r.status),
    path: text(r.worktree_path),
    ...inspect(text(r.worktree_path)),
  }));
  const home = path.resolve(root) + path.sep;
  const folders = new Map<string, FolderState>();
  for (const s of states) {
    const folder = folders.get(s.path) ?? {
      path: s.path,
      insideHome: path.resolve(s.path).startsWith(home),
      executions: [],
      missing: s.missing,
      branch: s.branch,
      uncommitted: s.uncommitted,
      unpushed: s.unpushed,
      error: s.error,
    };
    folder.executions.push({ id: s.executionId, label: s.label, agent: s.agent, status: s.status });
    folders.set(s.path, folder);
  }
  return {
    folders: [...folders.values()],
    root,
    worktrees: states.length,
    here: states.filter((s) => !s.missing).length,
    withWork: states.filter((s) => !s.error && (s.uncommitted > 0 || s.unpushed > 0)),
    missing: states.filter((s) => s.missing).length,
    errors: states.filter((s) => s.error),
  };
}

export function describeUnpublishedWork(report: UnpublishedWorkReport): string {
  const here = report.folders.filter((f) => !f.missing);
  const inside = here.filter((f) => f.insideHome);
  const withWork = here.filter((f) => !f.error && (f.uncommitted > 0 || f.unpushed > 0));
  const lines = [
    `${report.worktrees} executions in ${report.root} ran in ${report.folders.length} folders: ${here.length} here, ${report.folders.length - here.length} no longer here.`,
    `${inside.length} of those here are worktrees inside ${report.root}, so they move if that folder moves.`,
    withWork.length ? `${withWork.length} folders have work no remote has:` : "No folder has work that isn't committed and pushed.",
  ];
  for (const f of withWork) {
    const what = [f.uncommitted ? `${f.uncommitted} uncommitted` : '', f.unpushed ? `${f.unpushed} unpushed commits` : ''].filter(Boolean).join(', ');
    const agents = [...new Set(f.executions.map((e) => e.agent))].join(', ');
    const used = f.executions.length === 1 ? `"${f.executions[0]!.label}" [${f.executions[0]!.status}]` : `${f.executions.length} executions`;
    lines.push(`  ${f.path}${f.insideHome ? ' (inside the home)' : ''}\n    ${what}${f.branch ? ` on ${f.branch}` : ''}. ${agents}: ${used}`);
  }
  const unreadable = here.filter((f) => f.error);
  if (unreadable.length) {
    lines.push(`${unreadable.length} couldn't be read:`);
    for (const f of unreadable) lines.push(`  ${f.path}: ${f.error} (${f.executions.length} executions)`);
  }
  return lines.join('\n');
}
