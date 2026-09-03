/**
 * Diff-stat correctness against real git repos.
 *
 * These build throwaway repos rather than mocking git, because the bug this
 * module exists to fix was a semantic one — `git diff <base>` never reports
 * untracked files — and no mock would have caught it.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mapWithConcurrency, readWorktreeDiffStats } from './diff-stats';

/**
 * Every case forks several real `git` processes, and a dev box running agents
 * can be loaded enough that a single spawn takes seconds. The default 5s would
 * make these flaky for reasons that have nothing to do with the assertions.
 */
const TIMEOUT_MS = 60_000;

let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf-8' }).trim();
}

function write(rel: string, body: string) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-stats-'));
  git('init', '-q', '-b', 'main', '.');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  write('a.txt', 'one\ntwo\nthree\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
}, TIMEOUT_MS);

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
}, TIMEOUT_MS);

/**
 * Default shape: a dedicated worktree branched from `main`, so the anchor is
 * the per-execution `baseSha`. Cases that exercise the other anchor pass
 * `inPlace`.
 */
function stats(opts: {
  baseBranch?: string | null;
  baseSha?: string | null;
  inPlace?: boolean;
} = {}) {
  return readWorktreeDiffStats({
    worktreePath: repo,
    baseBranch: opts.baseBranch === undefined ? 'main' : opts.baseBranch,
    baseSha: opts.baseSha ?? null,
    inPlace: opts.inPlace ?? false,
  });
}

/** Every worktree case here branches off `main`, so this is the usual anchor. */
function fromMain() {
  return stats({ baseSha: git('rev-parse', 'main') });
}

describe('readWorktreeDiffStats', () => {
  it('reports zero on a clean tree', async () => {
    git('checkout', '-qb', 'feat');
    expect(await fromMain()).toEqual({ files: 0, additions: 0, deletions: 0 });
  }, TIMEOUT_MS);

  it('counts uncommitted edits to tracked files', async () => {
    git('checkout', '-qb', 'feat');
    write('a.txt', 'one\ntwo\nthree\nfour\n');
    expect(await fromMain()).toEqual({ files: 1, additions: 1, deletions: 0 });
  }, TIMEOUT_MS);

  it('counts committed and uncommitted work together', async () => {
    git('checkout', '-qb', 'feat');
    write('a.txt', 'one\ntwo\nthree\nfour\n');
    git('commit', '-qam', 'c1');
    write('a.txt', 'one\ntwo\nthree\nfour\nfive\n');
    expect(await fromMain()).toEqual({ files: 1, additions: 2, deletions: 0 });
  }, TIMEOUT_MS);

  // The regression this module was written for: an agent's brand-new files
  // are untracked, and `git diff <base>` cannot see them.
  it('counts untracked files the old shortstat path missed', async () => {
    git('checkout', '-qb', 'feat');
    write('brand-new.ts', 'a\nb\nc\nd\ne\n');
    expect(await fromMain()).toEqual({ files: 1, additions: 5, deletions: 0 });
  }, TIMEOUT_MS);

  it('counts tracked edits and untracked files in one total', async () => {
    git('checkout', '-qb', 'feat');
    write('a.txt', 'one\ntwo\n');
    write('brand-new.ts', 'a\nb\nc\n');
    expect(await fromMain()).toEqual({ files: 2, additions: 3, deletions: 1 });
  }, TIMEOUT_MS);

  it('counts a final line with no trailing newline', async () => {
    git('checkout', '-qb', 'feat');
    write('no-newline.ts', 'a\nb\nc');
    expect(await fromMain()).toEqual({ files: 1, additions: 3, deletions: 0 });
  }, TIMEOUT_MS);

  it('counts an empty new file as a file with no lines', async () => {
    git('checkout', '-qb', 'feat');
    write('empty.ts', '');
    expect(await fromMain()).toEqual({ files: 1, additions: 0, deletions: 0 });
  }, TIMEOUT_MS);

  it('counts an untracked binary file without counting lines', async () => {
    git('checkout', '-qb', 'feat');
    fs.writeFileSync(path.join(repo, 'blob.bin'), Buffer.from([1, 0, 2, 0, 3]));
    expect(await fromMain()).toEqual({ files: 1, additions: 0, deletions: 0 });
  }, TIMEOUT_MS);

  it('respects .gitignore so build output is not counted as work', async () => {
    write('.gitignore', 'dist/\n');
    git('add', '-A');
    git('commit', '-qm', 'ignore dist');
    git('checkout', '-qb', 'feat');
    write('dist/bundle.js', 'x\n'.repeat(5000));
    expect(await fromMain()).toEqual({ files: 0, additions: 0, deletions: 0 });
  }, TIMEOUT_MS);

  it('counts deletions', async () => {
    git('checkout', '-qb', 'feat');
    fs.rmSync(path.join(repo, 'a.txt'));
    expect(await fromMain()).toEqual({ files: 1, additions: 0, deletions: 3 });
  }, TIMEOUT_MS);

  it('ignores commits that land on the base branch after the fork point', async () => {
    const baseSha = git('rev-parse', 'main');
    git('checkout', '-qb', 'feat');
    write('feature.txt', 'f\n');
    git('add', '-A');
    git('commit', '-qm', 'feature work');

    // Unrelated history piles onto main after the branch point.
    git('checkout', '-q', 'main');
    write('unrelated.txt', 'x\n'.repeat(500));
    git('add', '-A');
    git('commit', '-qm', 'lots of other work');
    git('checkout', '-q', 'feat');

    expect(await stats({ baseSha })).toEqual({ files: 1, additions: 1, deletions: 0 });
  }, TIMEOUT_MS);

  // The phantom-diff guard. A Live-mode session shares the checkout with the
  // branch, so HEAD keeps moving after the session started; anchoring on the
  // frozen sha would bill every later commit to this session.
  it('anchors an in-place session on the live merge-base, not its frozen sha', async () => {
    const frozen = git('rev-parse', 'HEAD');

    // Work lands on main after the session started — someone else's commits.
    write('unrelated.txt', 'x\n'.repeat(500));
    git('add', '-A');
    git('commit', '-qm', 'later work on the shared branch');
    // ...and the session's own uncommitted edit.
    write('a.txt', 'one\ntwo\nthree\nfour\n');

    expect(await stats({ baseSha: frozen, inPlace: true })).toEqual({
      files: 1,
      additions: 1,
      deletions: 0,
    });
    // Anchoring on the frozen sha instead is the phantom diff this guards.
    expect(await stats({ baseSha: frozen, inPlace: false })).toEqual({
      files: 2,
      additions: 501,
      deletions: 0,
    });
  }, TIMEOUT_MS);

  // The bug that motivated reading the anchor from our own DB: a session
  // created from a PR head starts at that head, not at the base branch.
  it('anchors a PR-head session on its own start commit, not the base branch', async () => {
    // A PR branch that diverged from main a while ago and has its own history.
    git('checkout', '-qb', 'pr-90');
    write('pr-feature.txt', 'p\n'.repeat(200));
    git('add', '-A');
    git('commit', '-qm', 'the PR itself');
    const prHead = git('rev-parse', 'HEAD');

    // The session branches off the PR head and adds one line.
    git('checkout', '-qb', 'session');
    write('a.txt', 'one\ntwo\nthree\nfour\n');

    expect(await stats({ baseSha: prHead })).toEqual({
      files: 1,
      additions: 1,
      deletions: 0,
    });
    // Anchoring on `main` — which is what the shared `agentex.json` metadata
    // could hand back — would bill the whole PR to this session.
    expect(await stats({ baseBranch: 'main', baseSha: null })).toEqual({
      files: 2,
      additions: 201,
      deletions: 0,
    });
  }, TIMEOUT_MS);

  it('falls back to the other anchor when the preferred one will not resolve', async () => {
    const baseSha = git('rev-parse', 'HEAD');
    git('checkout', '-qb', 'feat');
    write('a.txt', 'one\ntwo\nthree\nfour\n');
    // In-place prefers the branch; a deleted branch must fall through to the sha.
    expect(await stats({ baseBranch: 'gone', baseSha, inPlace: true })).toEqual({
      files: 1,
      additions: 1,
      deletions: 0,
    });
    // And the reverse: an unresolvable sha falls through to the branch.
    expect(await stats({ baseBranch: 'main', baseSha: 'f'.repeat(40) })).toEqual({
      files: 1,
      additions: 1,
      deletions: 0,
    });
  }, TIMEOUT_MS);

  it('returns null when no anchor resolves at all', async () => {
    expect(await stats({ baseBranch: 'nope', baseSha: 'f'.repeat(40) })).toBeNull();
  }, TIMEOUT_MS);

  it('returns null when the session has no anchor recorded', async () => {
    expect(await stats({ baseBranch: null, baseSha: null })).toBeNull();
  }, TIMEOUT_MS);

  it('returns null when the worktree is gone from disk', async () => {
    expect(
      await readWorktreeDiffStats({
        worktreePath: path.join(repo, 'deleted-elsewhere'),
        baseBranch: 'main',
        baseSha: null,
        inPlace: false,
      }),
    ).toBeNull();
  }, TIMEOUT_MS);

  it('returns null when the session has no worktree', async () => {
    expect(
      await readWorktreeDiffStats({
        worktreePath: null,
        baseBranch: 'main',
        baseSha: null,
        inPlace: false,
      }),
    ).toBeNull();
  }, TIMEOUT_MS);
});

describe('readWorktreeDiffStats coalescing', () => {
  it('shares one in-flight computation across concurrent identical calls', async () => {
    git('checkout', '-qb', 'feat');
    write('a.txt', 'one\ntwo\nthree\nfour\n');
    const baseSha = git('rev-parse', 'main');
    const target = { worktreePath: repo, baseBranch: 'main', baseSha, inPlace: false };

    const p1 = readWorktreeDiffStats(target);
    // A distinct object with equal inputs, issued before the first settles:
    // it must ride the first promise rather than fork its own git processes.
    const p2 = readWorktreeDiffStats({ ...target });
    expect(p1).toBe(p2);
    expect(await p1).toEqual({ files: 1, additions: 1, deletions: 0 });
  }, TIMEOUT_MS);

  it('does not coalesce calls whose inputs differ', async () => {
    const baseSha = git('rev-parse', 'main');
    const p1 = readWorktreeDiffStats({
      worktreePath: repo,
      baseBranch: 'main',
      baseSha,
      inPlace: false,
    });
    // `inPlace` flips which ref anchors the diff, so the result can differ —
    // these must not share a computation.
    const p2 = readWorktreeDiffStats({
      worktreePath: repo,
      baseBranch: 'main',
      baseSha,
      inPlace: true,
    });
    expect(p1).not.toBe(p2);
    await Promise.all([p1, p2]);
  }, TIMEOUT_MS);

  it('clears the shared slot after settling so a later call recomputes', async () => {
    const baseSha = git('rev-parse', 'main');
    const target = { worktreePath: repo, baseBranch: 'main', baseSha, inPlace: false };
    const first = readWorktreeDiffStats(target);
    await first;
    // The first has settled and released the slot, so this is a fresh run,
    // free to observe changes that landed in between.
    const second = readWorktreeDiffStats(target);
    expect(second).not.toBe(first);
    await second;
  }, TIMEOUT_MS);
});

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const out = await mapWithConcurrency([30, 10, 20, 0], 2, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `${i}:${ms}`;
    });
    expect(out).toEqual(['0:30', '1:10', '2:20', '3:0']);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
