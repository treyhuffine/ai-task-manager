/**
 * Git commit the brain dir — free markdown version history.
 *
 * Ensures a `.git` repo exists at the home root, then `git add . && git
 * commit` with a timestamped message. Tracks everything the home ships,
 * including `data.db` + `attachments/` — git is a full restorable backup.
 * The machine-local `.config/`/`.work/` + DB sidecars are excluded by the
 * home's shipped `.gitignore` (paths.ts `GITIGNORE_BODY`), which is the
 * single source of truth. Idempotent: no changes since last commit ⇒ no-op.
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
 * Initialize git at the home root if needed, then commit any changes with a
 * timestamped message. The home's shipped `.gitignore` (written by
 * `ensureAppRoot`, which `ensureBrainDir` calls) is the single source of
 * truth for what's excluded — we don't maintain a second list here. Caller
 * flushes the mirror first if they want the commit to reflect the latest DB.
 */
export function commitBrain(): CommitBrainResult {
  const dir = ensureBrainDir();

  if (!fs.existsSync(path.join(dir, '.git'))) {
    run('git', ['init', '--quiet', '--initial-branch=main'], dir);
  }

  // Stage everything under the home (respects the shipped .gitignore).
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
