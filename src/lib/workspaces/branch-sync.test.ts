/**
 * `readBranchSync` and `pullUpstreamInto` against real repositories: a bare
 * remote, the worktree's clone, and a second clone playing "someone else".
 * The bug these exist for is git semantics (what the upstream is before and
 * after the first push), which no mock would catch.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pullUpstreamInto, readBranchSync, resetRefreshThrottle } from './branch-sync';

const TIMEOUT_MS = 60_000;

let root: string;
let remote: string;
let work: string;
let other: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
}

function clone(dir: string) {
  git(root, 'clone', '-q', remote, dir);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

function commit(cwd: string, file: string, body = `${file}\n`) {
  fs.writeFileSync(path.join(cwd, file), body);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', file);
}

/** What a merge does for the library's handle: `git merge`, no editor. */
function handleFor(cwd: string) {
  return {
    path: cwd,
    git: {
      mergeFrom: async (ref: string) => {
        git(cwd, 'merge', '-q', '--no-edit', ref);
      },
    },
  };
}

const sync = (cwd: string) => readBranchSync(cwd, { baseBranch: 'main', remoteName: null });

beforeEach(() => {
  resetRefreshThrottle();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-sync-'));
  remote = path.join(root, 'remote.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  const seed = path.join(root, 'seed');
  clone(seed);
  commit(seed, 'README.md');
  git(seed, 'push', '-q', 'origin', 'HEAD:main');
  // A worktree's branch starts from origin/main and tracks it, as Ri creates them.
  work = path.join(root, 'work');
  clone(work);
  git(work, 'checkout', '-q', '-b', 'feat', '--track', 'origin/main');
  other = path.join(root, 'other');
  clone(other);
}, TIMEOUT_MS);

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
}, TIMEOUT_MS);

describe('readBranchSync', () => {
  it('reads the upstream as the base until the first push', async () => {
    commit(work, 'a.ts');
    expect(await sync(work)).toEqual({ upstream: 'origin/main', upstreamIsBase: true, base: 'origin/main', behindBase: 0 });
  }, TIMEOUT_MS);

  it("reads the branch's own remote copy after it, and still counts against the base", async () => {
    commit(work, 'a.ts');
    git(work, 'push', '-q', '--set-upstream', 'origin', 'HEAD');
    // Main moves on, and this side has fetched it.
    commit(other, 'main.ts');
    git(other, 'push', '-q', 'origin', 'HEAD:main');
    git(work, 'fetch', '-q', 'origin');
    expect(await sync(work)).toEqual({ upstream: 'origin/feat', upstreamIsBase: false, base: 'origin/main', behindBase: 1 });
  }, TIMEOUT_MS);

  it('says no upstream for a branch that tracks nothing', async () => {
    git(work, 'checkout', '-q', '-b', 'loose', 'origin/main', '--no-track');
    expect(await sync(work)).toMatchObject({ upstream: null, upstreamIsBase: false, behindBase: 0 });
  }, TIMEOUT_MS);

  it('falls back to the remote default branch when no base is configured', async () => {
    git(work, 'remote', 'set-head', 'origin', 'main');
    expect(await readBranchSync(work, { baseBranch: null, remoteName: null })).toMatchObject({ base: 'origin/main' });
  }, TIMEOUT_MS);

  it('refreshes the base from the remote in the background, so the next read is current', async () => {
    commit(other, 'main.ts');
    git(other, 'push', '-q', 'origin', 'HEAD:main');
    expect((await sync(work)).behindBase).toBe(0);
    // The first read kicked off a fetch. Give it a moment, then read again.
    const deadline = Date.now() + 20_000;
    let behind = 0;
    while (Date.now() < deadline && behind === 0) {
      await new Promise((r) => setTimeout(r, 200));
      behind = (await sync(work)).behindBase ?? 0;
    }
    expect(behind).toBe(1);
  }, TIMEOUT_MS);
});

describe('pullUpstreamInto', () => {
  it("brings in what someone else pushed to the branch's remote copy", async () => {
    commit(work, 'a.ts');
    git(work, 'push', '-q', '--set-upstream', 'origin', 'HEAD');
    git(other, 'fetch', '-q', 'origin');
    git(other, 'checkout', '-q', 'feat');
    commit(other, 'theirs.ts');
    git(other, 'push', '-q', 'origin', 'feat');

    await pullUpstreamInto(handleFor(work), { strategy: 'merge' });
    expect(fs.existsSync(path.join(work, 'theirs.ts'))).toBe(true);
    expect(git(work, 'rev-parse', 'HEAD')).toBe(git(other, 'rev-parse', 'HEAD'));
  }, TIMEOUT_MS);

  it('refuses a branch that tracks nothing', async () => {
    git(work, 'checkout', '-q', '-b', 'loose', 'origin/main', '--no-track');
    await expect(pullUpstreamInto(handleFor(work), { strategy: 'merge' })).rejects.toThrow(/tracks no remote branch/);
  }, TIMEOUT_MS);
});
