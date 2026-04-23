/**
 * Git commit the brain dir — free markdown version history.
 *
 * Ensures a `.git` repo exists inside `<brain>/`, writes a `.gitignore` that
 * excludes the DB and attachments, then `git add . && git commit` with a
 * timestamped message. Idempotent: if there are no changes since the last
 * commit, it's a no-op.
 *
 * Intended for use alongside the live mirror: markdown files get overwritten
 * in place as entities change, but each `commitBrain()` freezes a diffable
 * snapshot in git history. Pairs well with `<app> snapshot` (local dated
 * artifact) and `scripts/backup.ts` (cloud push).
 *
 * Does not push — the user's remote is their choice. Configure with
 * `git -C <brain> remote add origin <url>` and push from a cron or manually.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureBrainDir, getBrainDir } from '@/lib/config/paths';
import { APP_SHORT_ID } from '@/constants/app';

const GITIGNORE_ENTRIES = [
  '# Managed by ' + APP_SHORT_ID + '. Database and binary files are not tracked.',
  'data.db',
  'data.db-wal',
  'data.db-shm',
  'attachments/',
];

export interface CommitBrainResult {
  /** Absolute path to the brain dir. */
  dir: string;
  /** True if a commit was created; false if nothing changed. */
  committed: boolean;
  /** Short SHA of the commit (when committed). */
  sha?: string;
  /** Commit message used (when committed). */
  message?: string;
}

/**
 * Initialize git in brain/ if needed, sync `.gitignore`, then commit any
 * changes with a timestamped message. Caller is responsible for flushing
 * the mirror first if they want the commit to reflect the latest state.
 */
export function commitBrain(): CommitBrainResult {
  const dir = ensureBrainDir();

  if (!fs.existsSync(path.join(dir, '.git'))) {
    run('git', ['init', '--quiet', '--initial-branch=main'], dir);
  }

  ensureGitignore(dir);

  // Stage everything under brain/ (respects .gitignore).
  run('git', ['add', '.'], dir);

  // Check whether there's anything to commit. `git diff --cached --quiet`
  // exits 1 if there are staged changes.
  const dirty = hasStagedChanges(dir);
  if (!dirty) {
    return { dir, committed: false };
  }

  const message = `${APP_SHORT_ID}: ${new Date().toISOString()}`;
  run('git', ['commit', '--quiet', '--no-gpg-sign', '-m', message], dir);
  const sha = run('git', ['rev-parse', '--short', 'HEAD'], dir).trim();

  return { dir, committed: true, sha, message };
}

function ensureGitignore(dir: string): void {
  const file = path.join(dir, '.gitignore');
  const expected = GITIGNORE_ENTRIES.join('\n') + '\n';

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, expected, 'utf8');
    return;
  }

  // Merge: preserve anything the user added, but make sure our entries are
  // all present.
  const existing = fs.readFileSync(file, 'utf8');
  const lines = new Set(existing.split('\n').map((l) => l.trim()));
  const missing = GITIGNORE_ENTRIES.filter((e) => !e.startsWith('#') && !lines.has(e));
  if (missing.length > 0) {
    const appended = existing.replace(/\n*$/, '\n') + missing.join('\n') + '\n';
    fs.writeFileSync(file, appended, 'utf8');
  }
}

function hasStagedChanges(dir: string): boolean {
  try {
    execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: dir, stdio: 'pipe' });
    return false;
  } catch {
    return true;
  }
}

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' });
}

/** Re-exported for callers that want the brain path without the side effect. */
export { getBrainDir };
