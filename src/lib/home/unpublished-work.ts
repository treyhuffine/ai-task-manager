/**
 * Work that exists only on this computer, before retiring its home
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
  /** The folder isn't on this computer (anymore). */
  missing: boolean;
  branch: string | null;
  /** Files changed or new, not committed. */
  uncommitted: number;
  /** Commits on this branch that no remote has. */
  unpushed: number;
  error: string | null;
}

export interface UnpublishedWorkReport {
  root: string;
  worktrees: number;
  here: number;
  withWork: WorktreeState[];
  missing: number;
  errors: WorktreeState[];
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
  const states: WorktreeState[] = rows.map((r) => ({
    executionId: text(r.id),
    label: text(r.label) || '(unlabeled)',
    agent: text(r.agent),
    status: text(r.status),
    path: text(r.worktree_path),
    ...inspectWorktree(text(r.worktree_path)),
  }));
  return {
    root,
    worktrees: states.length,
    here: states.filter((s) => !s.missing).length,
    withWork: states.filter((s) => !s.error && (s.uncommitted > 0 || s.unpushed > 0)),
    missing: states.filter((s) => s.missing).length,
    errors: states.filter((s) => s.error),
  };
}

export function describeUnpublishedWork(report: UnpublishedWorkReport): string {
  const lines = [
    `${report.worktrees} execution worktrees recorded in ${report.root}: ${report.here} here, ${report.missing} no longer here.`,
    report.withWork.length
      ? `${report.withWork.length} have work no remote has:`
      : "None has work that isn't committed and pushed.",
  ];
  for (const s of report.withWork) {
    const what = [s.uncommitted ? `${s.uncommitted} uncommitted` : '', s.unpushed ? `${s.unpushed} unpushed commits` : ''].filter(Boolean).join(', ');
    lines.push(`  ${s.agent} / ${s.label} [${s.status}]: ${what}${s.branch ? ` on ${s.branch}` : ''}\n    ${s.path}`);
  }
  if (report.errors.length) {
    lines.push(`${report.errors.length} couldn't be read:`);
    for (const s of report.errors) lines.push(`  ${s.agent} / ${s.label}: ${s.error}\n    ${s.path}`);
  }
  return lines.join('\n');
}
