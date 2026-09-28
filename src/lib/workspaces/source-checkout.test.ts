import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { WorkspaceRecord } from '@/db/types';
import {
  createWorktreeForSession,
  fetchPrHead,
  getWorkspaceBaseStatus,
  listWorkspaceBranches,
  openWorktreeHandle,
  pullBase,
  pullWorkspaceBase,
} from './index';

/**
 * The workspace's own checkout, opened with a base from our records.
 *
 * agentex only records a base for worktrees it creates. Every clone here is
 * one agentex never touched, like a repo on a freshly set up machine: before
 * this, opening it threw "has no base metadata" (0.0.5), and on 0.0.4 it only
 * worked when the server's own cwd happened to carry Ri's worktree metadata.
 * The pull cases cover the other half: Ri roots worktrees at `origin/main`,
 * which agentex's `pullLatestBase` turned into `git fetch origin origin/main`.
 */

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-source-checkout-')));
const ORIGIN = path.join(ROOT, 'origin.git');
const SEED = path.join(ROOT, 'seed');
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const GIT_ENV = { GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@b', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@b' };
const sh = (cwd: string, cmd: string) => execSync(cmd, { cwd, env: { ...process.env, ...GIT_ENV } }).toString().trim();

/** Commit a file in the seed clone and push it to `ref` on origin. */
function pushFromSeed(file: string, ref = 'main') {
  fs.writeFileSync(path.join(SEED, file), `${file}\n`);
  sh(SEED, `git add -A && git commit -qm ${file} && git push -q origin HEAD:${ref}`);
}

let n = 0;
/** A fresh clone of origin and a workspace record pointing at it. */
function cloneWorkspace(): WorkspaceRecord {
  const name = `clone-${++n}`;
  sh(ROOT, `git clone -q ${ORIGIN} ${name}`);
  return {
    id: name,
    slug: name,
    cwd: path.join(ROOT, name),
    isGit: true,
    baseBranch: 'main',
    remoteName: 'origin',
    worktreeRoot: path.join(ROOT, 'worktrees', name),
  } as WorkspaceRecord;
}

const sessionId = (i: number) => `0190a1b2-c3d4-7e5f-8a9b-${String(i).padStart(12, '0')}`;

beforeAll(() => {
  Object.assign(process.env, GIT_ENV);
  sh(ROOT, 'git init -q --bare -b main origin.git');
  sh(ROOT, `git clone -q ${ORIGIN} seed`);
  pushFromSeed('README.md');
});

describe('listWorkspaceBranches', () => {
  it('lists remote branches newest first on a clone agentex never touched', async () => {
    const ws = cloneWorkspace();
    sh(SEED, 'git checkout -qb feature-x');
    pushFromSeed('feature.txt', 'feature-x');
    sh(SEED, 'git checkout -q main');
    sh(ws.cwd, 'git fetch -q origin');

    expect(await listWorkspaceBranches(ws)).toEqual(['origin/feature-x', 'origin/main']);
  });
});

describe('Live freshness', () => {
  it('reports how far the checkout is behind, then pulls the base in', async () => {
    const ws = cloneWorkspace();
    pushFromSeed('upstream.txt');

    expect(await getWorkspaceBaseStatus(ws)).toEqual({
      branch: 'main',
      base: 'main',
      behind: 1,
      dirty: false,
      warning: null,
    });
    expect(await pullWorkspaceBase(ws)).toEqual({ ok: true, behind: 1 });
    expect(fs.existsSync(path.join(ws.cwd, 'upstream.txt'))).toBe(true);
    expect((await getWorkspaceBaseStatus(ws)).behind).toBe(0);
  });
});

describe('openWorktreeHandle, in place', () => {
  it('bases on origin/main, so unpushed commits count as the session\'s changes', async () => {
    const ws = cloneWorkspace();
    const upstream = sh(ws.cwd, 'git rev-parse origin/main');
    fs.writeFileSync(path.join(ws.cwd, 'committed.txt'), 'local\n');
    sh(ws.cwd, 'git add -A && git commit -qm local');
    fs.writeFileSync(path.join(ws.cwd, 'uncommitted.txt'), 'wip\n');

    const handle = await openWorktreeHandle({ worktreePath: ws.cwd, baseSha: null }, ws);
    expect(handle?.kind).toBe('git');
    if (handle?.kind !== 'git') return;
    expect(handle.git.base).toBe('origin/main');
    expect(handle.git.baseSha).toBe(upstream);
    const changed = (await handle.git.diff('base')).files.map((f) => f.path).sort();
    expect(changed).toEqual(['committed.txt', 'uncommitted.txt']);
  });

  it('falls back to the local branch when there is no remote-tracking ref', async () => {
    const dir = path.join(ROOT, 'no-remote');
    fs.mkdirSync(dir);
    sh(dir, 'git init -q -b main && git commit -q --allow-empty -m init');
    const ws = { cwd: dir, baseBranch: 'main', remoteName: 'origin' };

    const handle = await openWorktreeHandle({ worktreePath: dir }, ws);
    expect(handle?.kind === 'git' && handle.git.base).toBe('main');
  });

  it('returns null when the folder is gone', async () => {
    const gone = path.join(ROOT, 'gone');
    expect(await openWorktreeHandle({ worktreePath: gone }, { cwd: gone, baseBranch: 'main', remoteName: 'origin' })).toBeNull();
  });
});

describe('pullBase into a worktree session', () => {
  it('pulls the origin/main a worktree is rooted at', async () => {
    const ws = cloneWorkspace();
    const wt = await createWorktreeForSession({ ws, sessionId: sessionId(1), sessionLabel: 'pull' });
    pushFromSeed('after-create.txt');

    const handle = await openWorktreeHandle({ worktreePath: wt.path }, ws);
    if (handle?.kind !== 'git') throw new Error('expected a git handle');
    expect(handle.git.base).toBe('origin/main');
    await pullBase({ ws, handle, base: handle.git.base, strategy: 'merge' });
    expect(fs.existsSync(path.join(wt.path, 'after-create.txt'))).toBe(true);
  });

  it('refetches a PR head, picking up what was pushed to the PR since', async () => {
    const ws = cloneWorkspace();
    sh(SEED, 'git checkout -qb pr-7');
    pushFromSeed('pr-first.txt', 'refs/pull/7/head');
    const { ref } = await fetchPrHead({ ws, prNumber: 7 });
    const wt = await createWorktreeForSession({ ws, sessionId: sessionId(2), sessionLabel: 'pr', baseBranchOverride: ref });
    pushFromSeed('pr-second.txt', 'refs/pull/7/head');
    sh(SEED, 'git checkout -q main');

    const handle = await openWorktreeHandle({ worktreePath: wt.path }, ws);
    if (handle?.kind !== 'git') throw new Error('expected a git handle');
    expect(handle.git.base).toBe('refs/agentex/pr/7');
    await pullBase({ ws, handle, base: handle.git.base, strategy: 'merge' });
    expect(fs.existsSync(path.join(wt.path, 'pr-second.txt'))).toBe(true);
  });

  it('fails loudly when the base cannot be fetched, rather than merging a stale ref', async () => {
    const ws = cloneWorkspace();
    const wt = await createWorktreeForSession({ ws, sessionId: sessionId(3), sessionLabel: 'gone' });
    const handle = await openWorktreeHandle({ worktreePath: wt.path }, ws);
    if (handle?.kind !== 'git') throw new Error('expected a git handle');
    await expect(pullBase({ ws, handle, base: 'origin/deleted', strategy: 'merge' })).rejects.toThrow(
      /^Couldn't fetch deleted from origin\./,
    );
  });
});
