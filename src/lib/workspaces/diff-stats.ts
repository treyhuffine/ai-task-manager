/**
 * Line counts for a session's worktree, sized for the rail badge.
 *
 * Deliberately does NOT go through `openWorktreeHandle` + `ws.git.shortstat()`.
 * That path was both slow and, for some sessions, wrong:
 *
 * **Slow.** It cost six `git` spawns per call — current branch, worktree
 * metadata, merge-base, then a second full re-open (branch + metadata again)
 * purely to swap the base sha, then the diff. The rail renders one badge per
 * row and the history tab renders up to 200, so painting a list of numbers
 * forked over a thousand git processes.
 *
 * **Wrong, twice.** `git diff <base>` only walks the index, so files the agent
 * just created were invisible until something staged them — and creating files
 * is most of what an agent session does (see `readUntrackedStats`). And the
 * base ref it diffed against came from `@agentex/workspace`'s worktree
 * metadata, which is not actually per-worktree (see `resolveAnchor`).
 *
 * Here it's two spawns, issued in parallel, and neither depends on the other:
 *
 *   1. `git diff --numstat --merge-base <anchor>` — tracked changes. The
 *      `--merge-base` flag (git 2.30+) is exactly `git diff $(git merge-base
 *      <anchor> HEAD)`, folding the separate merge-base call into the diff.
 *   2. `git ls-files --others --exclude-standard` — the untracked half.
 *
 * Everything else the handle computed (current branch, source-repo resolution,
 * metadata) is unused by a line count and is skipped.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { runGit } from './git-gate';

const execFileAsync = promisify(execFile);

/** Matches `DiffStats` on the wire (`src/lib/api/sessions.ts`). */
export interface WorktreeDiffStats {
  files: number;
  additions: number;
  deletions: number;
}

const ZERO: WorktreeDiffStats = { files: 0, additions: 0, deletions: 0 };

/**
 * Untracked files above this are counted as changed but contribute no lines.
 * A multi-megabyte untracked file is a build artifact someone forgot to
 * ignore, not work product worth stalling every rail row to tally.
 */
const MAX_UNTRACKED_BYTES_TO_COUNT = 4 * 1024 * 1024;

/** Parallel `readFile`s, capped so a worktree full of new files can't hit EMFILE. */
const UNTRACKED_READ_CONCURRENCY = 16;

/** Bounded-concurrency map. Preserves input order in the result. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface DiffStatsTarget {
  /** Absolute path of the session's worktree. */
  worktreePath: string | null;
  /** The workspace's configured base branch, e.g. `main`. */
  baseBranch: string | null;
  /** `executions.base_sha` — where THIS session started. */
  baseSha: string | null;
  /**
   * True when the session runs in the workspace's own checkout rather than a
   * dedicated worktree (Live mode sets `worktreePath = workspace.cwd`).
   */
  inPlace: boolean;
}

/**
 * Ordered list of refs to measure "what this session changed" against.
 *
 * Which ref is right depends on how the session was started, and the answer is
 * in our own database — not in git.
 *
 *   - **Dedicated worktree.** `executions.base_sha` is the exact commit this
 *     session branched from: the base branch tip for a normal session, the PR
 *     head for a "create from PR" session, the picked ref for a branch
 *     override. It is per-execution and therefore always this session's own
 *     starting point.
 *   - **In place (Live mode).** The "worktree" IS the shared checkout, so HEAD
 *     marches forward with every commit that lands on the branch afterwards
 *     while `base_sha` stays frozen at session start. Diffing against the
 *     frozen value attributes all of that unrelated history to the session —
 *     the phantom "+211k" diff. The live merge-base with the base branch is
 *     the real divergence point.
 *
 * The previous implementation instead trusted `ws.git.base` from
 * `@agentex/workspace`, which reads `<gitdir>/info/agentex.json` via `git
 * rev-parse --git-path`. That path looks per-worktree but is not: git resolves
 * everything under `info/` to the COMMON git dir (it's where `info/exclude`
 * and `info/attributes` live), so every worktree of a repo shares one
 * `agentex.json` and the most recently created session's base overwrites
 * everyone else's. A repo holding both a normal session and a PR-head session
 * measured one of them against the other's base. Reading our own per-execution
 * columns sidesteps that entirely.
 *
 * Both entries are returned so an unresolvable ref (base branch deleted,
 * history rewritten) falls through to the other rather than blanking the badge.
 */
function resolveAnchor(target: DiffStatsTarget): string[] {
  const { baseBranch, baseSha, inPlace } = target;
  const preferred = inPlace ? [baseBranch, baseSha] : [baseSha, baseBranch];
  return preferred.filter((ref): ref is string => !!ref && ref.length > 0);
}

/**
 * Sum `git diff --numstat`. Each line is `<added>\t<deleted>\t<path>`; a
 * binary file reports `-\t-\t<path>` and counts toward `files` only — the
 * same rule `--shortstat` applies, so the two agree on binaries.
 */
function parseNumstat(stdout: string): WorktreeDiffStats {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue;
    const firstTab = line.indexOf('\t');
    if (firstTab < 0) continue;
    const secondTab = line.indexOf('\t', firstTab + 1);
    if (secondTab < 0) continue;
    files += 1;
    const added = parseInt(line.slice(0, firstTab), 10);
    const deleted = parseInt(line.slice(firstTab + 1, secondTab), 10);
    if (Number.isFinite(added)) additions += added;
    if (Number.isFinite(deleted)) deletions += deleted;
  }
  return { files, additions, deletions };
}

/**
 * Tracked changes between the session's divergence point and the working tree.
 *
 * `--merge-base <ref>` requires `<ref>` to resolve and to share history with
 * HEAD; when it doesn't, the next candidate anchor is tried. Returns null only
 * when none work — "we can't tell", which the rail renders as no badge rather
 * than a misleading zero.
 */
async function readTrackedStats(
  worktreePath: string,
  anchors: readonly string[],
): Promise<WorktreeDiffStats | null> {
  const common = ['diff', '--numstat', '--no-color', '--no-ext-diff', '--find-renames'];
  for (const anchor of anchors) {
    try {
      const { stdout } = await runGit(() =>
        execFileAsync('git', [...common, '--merge-base', anchor], {
          cwd: worktreePath,
          maxBuffer: 16 * 1024 * 1024,
        }),
      );
      return parseNumstat(stdout);
    } catch {
      // Try the next anchor.
    }
  }
  return null;
}

/**
 * Additions contributed by files git doesn't track yet.
 *
 * This is the half `ws.git.shortstat()` was missing. `git diff <base>` only
 * walks the index, so a file the agent just created is invisible to it until
 * something stages or commits it. The structured diff the slideout renders
 * (`readStructuredDiff`) *does* fold untracked files in, so the badge and the
 * diff it opens disagreed: a session that wrote five new files and touched
 * nothing else showed no badge at all.
 *
 * Line counting matches `buildUntrackedFileEntry` in `@agentex/workspace` so
 * the two surfaces produce the same number: a NUL byte in the first 8 KiB
 * means binary (counted as a file, no lines), and a trailing newline does not
 * imply a final empty line.
 */
async function readUntrackedStats(worktreePath: string): Promise<WorktreeDiffStats> {
  let names: string[];
  try {
    const { stdout } = await runGit(() =>
      execFileAsync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
        cwd: worktreePath,
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
    names = stdout.split('\0').filter((s) => s.length > 0);
  } catch {
    return ZERO;
  }
  if (names.length === 0) return ZERO;

  const perFile = await mapWithConcurrency(names, UNTRACKED_READ_CONCURRENCY, async (rel) => {
    const abs = path.join(worktreePath, rel);
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) return null;
      if (stat.size === 0) return 0;
      if (stat.size > MAX_UNTRACKED_BYTES_TO_COUNT) return 0;
      const buf = await fs.readFile(abs);
      if (buf.subarray(0, Math.min(buf.length, 8192)).includes(0)) return 0;
      let lines = 0;
      for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) lines += 1;
      // No trailing newline → the last partial line still counts.
      if (buf[buf.length - 1] !== 0x0a) lines += 1;
      return lines;
    } catch {
      // Raced with a delete, or unreadable — skip it entirely.
      return null;
    }
  });

  let files = 0;
  let additions = 0;
  for (const lines of perFile) {
    if (lines === null) continue;
    files += 1;
    additions += lines;
  }
  return { files, additions, deletions: 0 };
}

async function computeWorktreeDiffStats(
  target: DiffStatsTarget,
): Promise<WorktreeDiffStats | null> {
  const { worktreePath } = target;
  if (!worktreePath) return null;
  try {
    await fs.access(worktreePath);
  } catch {
    return null;
  }

  const anchors = resolveAnchor(target);
  if (anchors.length === 0) return null;

  const [tracked, untracked] = await Promise.all([
    readTrackedStats(worktreePath, anchors),
    readUntrackedStats(worktreePath),
  ]);
  if (tracked === null) return null;

  return {
    files: tracked.files + untracked.files,
    additions: tracked.additions + untracked.additions,
    deletions: tracked.deletions + untracked.deletions,
  };
}

/**
 * In-flight computations, keyed by the exact inputs that determine the result.
 * A second caller that arrives while the same measurement is still running
 * awaits the running promise instead of forking its own `git` processes.
 *
 * This is the server-side twin of TanStack Query's per-key fetch dedup: the
 * client coalesces every rail row's badge request into batched POSTs, but two
 * *independent* callers still reach the git layer separately — a second browser
 * tab, the single-session GET route firing while the batch POST is mid-flight,
 * or a window-focus refetch landing before the previous batch settled. Diff
 * stats are the heaviest read the rail issues (two `git` spawns plus a disk
 * read per untracked file), and they are exactly the requests that pile up
 * "multiple at once", so collapsing concurrent duplicates is where the spawn
 * savings are.
 *
 * Deliberately NOT a time-to-live cache. The badge has to move the instant an
 * agent writes a file, and a TTL would stall it for the TTL window. Sharing
 * only the *in-flight* promise never serves a result older than "computed just
 * now", so freshness is identical to computing every call — we only avoid
 * running the same measurement twice at the same moment.
 */
const inFlight = new Map<string, Promise<WorktreeDiffStats | null>>();

/** Every input that changes the result participates in the identity. */
function diffStatsKey(target: DiffStatsTarget): string {
  return [target.worktreePath, target.baseBranch, target.baseSha, target.inPlace ? 1 : 0].join(
    ' ',
  );
}

/**
 * Diff stats for one worktree, or null when they can't be determined — the
 * worktree is gone from disk (archived, another device, deleted by hand) or no
 * anchor ref resolves. Never throws.
 *
 * Concurrent calls with identical inputs share one computation; see `inFlight`.
 */
export function readWorktreeDiffStats(
  target: DiffStatsTarget,
): Promise<WorktreeDiffStats | null> {
  const key = diffStatsKey(target);
  const existing = inFlight.get(key);
  if (existing) return existing;

  // `.finally` clears the slot on both fulfilment and rejection, so a failed
  // measurement can't wedge every future caller onto a permanently-rejected
  // promise. A caller that arrives in the tick between settle and cleanup gets
  // the just-settled promise, which resolves immediately with a fresh value.
  const promise = computeWorktreeDiffStats(target).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
