import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import picomatch from 'picomatch';

const execFileAsync = promisify(execFile);

/**
 * `@agentex/workspace.copyFromSource` matches against the *full* POSIX
 * relative path. So bare patterns like `.env*` only match files at the
 * root. Conductor's UX is more forgiving — `.env*` also picks up
 * `discord/.env`. Mirror that: any pattern without a `/` also gets a
 * `**​/<pattern>` sibling so it matches at any depth.
 *
 * The original pattern is kept too, so authored `.env.*` still matches
 * root-level `.env.local` exactly the same way it always did.
 */
export function expandFilesToCopyPatterns(patterns: readonly string[]): string[] {
  const expanded = new Set<string>();
  for (const raw of patterns) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    expanded.add(trimmed);
    if (!trimmed.includes('/') && !trimmed.startsWith('**')) {
      expanded.add(`**/${trimmed}`);
    }
  }
  return Array.from(expanded);
}

/**
 * Dirs the copy walk skips at every depth. `.git` (never copyable) plus the
 * heavyweight build/dependency dirs — critically `node_modules`, which for a
 * pattern like `**​/.env*` would otherwise force a multi-second walk of the
 * whole dependency tree (and copy junk `.env.example` files out of packages).
 * The files people actually want to copy (root/app `.env`, local configs) are
 * never inside these.
 */
const ALWAYS_SKIP = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  '.cache',
  '.turbo',
  'coverage',
  'target',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
]);

const DEFAULT_MAX_FILES = 1000;

async function* walkFiles(root: string, relPrefix: string): AsyncGenerator<string> {
  const here = path.join(root, relPrefix);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(here, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (ALWAYS_SKIP.has(entry.name)) continue;
    const rel = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walkFiles(root, rel);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      yield rel;
    }
  }
}

/** Paths per `git ls-files` call, so a broad pattern can't overflow argv. */
const PATHSPEC_BATCH = 200;

/**
 * The subset of `rels` that git tracks in the checkout at `dir` (relative to
 * `dir`, as given). Empty when `dir` isn't inside a git checkout.
 */
async function trackedAmong(dir: string, rels: readonly string[]): Promise<Set<string>> {
  const tracked = new Set<string>();
  for (let i = 0; i < rels.length; i += PATHSPEC_BATCH) {
    const pathspecs = rels.slice(i, i + PATHSPEC_BATCH).map((rel) => `:(literal)${rel}`);
    try {
      const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--', ...pathspecs], {
        cwd: dir,
        maxBuffer: 8 * 1024 * 1024,
      });
      for (const file of stdout.split('\0')) if (file) tracked.add(file);
    } catch {
      return tracked;
    }
  }
  return tracked;
}

/**
 * Drop the files git tracks in any of `checkouts`. Tracked files are git's
 * to place: a worktree's checkout already holds them at its base commit. A
 * copy from the source folder would write that folder's version over them,
 * and it differs whenever the folder is on another branch or behind the
 * remote the worktree was rooted at, so a `.env.example` nobody touched
 * showed up changed (or untracked) in every new worktree.
 */
async function withoutTracked(rels: readonly string[], checkouts: readonly string[]): Promise<string[]> {
  if (rels.length === 0) return [];
  const tracked = await Promise.all(checkouts.map((dir) => trackedAmong(dir, rels)));
  return rels.filter((rel) => !tracked.some((set) => set.has(rel)));
}

/**
 * Copy every file in `sourceCwd` matching `patterns` (after expansion) into
 * `destDir`, preserving relative paths. Only local files travel: anything git
 * tracks in either checkout is skipped (see `withoutTracked`). Skips the
 * heavy dirs above, so it's fast and never drags `node_modules/*​/.env.example`
 * junk along. Best-effort per file; returns how many were copied. Runs in the
 * BACKGROUND after the worktree is ready — these files appear lazily, like
 * the setup script's.
 */
export async function copyFilesToWorktree(
  sourceCwd: string,
  destDir: string,
  patterns: readonly string[],
): Promise<number> {
  const expanded = expandFilesToCopyPatterns(patterns);
  if (expanded.length === 0) return 0;
  const matchers = expanded.map((p) => picomatch(p, { dot: true }));
  const matched: string[] = [];
  for await (const rel of walkFiles(sourceCwd, '')) {
    if (matchers.some((m) => m(rel))) matched.push(rel);
  }
  let copied = 0;
  for (const rel of await withoutTracked(matched, [sourceCwd, destDir])) {
    try {
      const to = path.join(destDir, rel);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(path.join(sourceCwd, rel), to);
      copied++;
    } catch {
      /* best-effort — a missing/locked file shouldn't abort the rest */
    }
  }
  return copied;
}

export interface PreviewFilesToCopyResult {
  files: string[];
  /** True when the walker hit the cap before exhausting matches. */
  truncated: boolean;
}

/**
 * Walk `cwd` and return relative POSIX paths matching any of `patterns`
 * (after expansion) that git doesn't track there. Designed for UI preview —
 * capped at 1000 hits.
 *
 * Result is the same set `copyFilesToWorktree` will copy at worktree-create
 * time, so the user sees exactly what will land in the new workspace.
 */
export async function previewFilesToCopy(
  cwd: string,
  patterns: readonly string[],
  opts: { maxFiles?: number } = {},
): Promise<PreviewFilesToCopyResult> {
  const expanded = expandFilesToCopyPatterns(patterns);
  if (expanded.length === 0) return { files: [], truncated: false };

  const matchers = expanded.map((p) => picomatch(p, { dot: true }));
  const results: string[] = [];
  const cap = opts.maxFiles ?? DEFAULT_MAX_FILES;
  let pending: string[] = [];
  let truncated = false;

  // Matches are checked against git in batches, so tracked ones don't count
  // toward the cap.
  for await (const rel of walkFiles(cwd, '')) {
    if (!matchers.some((m) => m(rel))) continue;
    pending.push(rel);
    if (results.length + pending.length < cap) continue;
    results.push(...(await withoutTracked(pending, [cwd])));
    pending = [];
    if (results.length >= cap) {
      truncated = true;
      break;
    }
  }
  results.push(...(await withoutTracked(pending, [cwd])));

  return { files: results.sort(), truncated };
}
