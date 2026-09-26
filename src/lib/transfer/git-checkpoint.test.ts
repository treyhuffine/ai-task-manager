/**
 * The Git side of moving work (P4.1, P4.2), against real repositories: a
 * bare remote and two clones standing in for two computers. What's tracked
 * and what was chosen is committed and pushed without force, secrets stay
 * behind, and the other side builds its worktree only at the exact commit,
 * refusing a divergent or busy branch without touching it.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CheckpointError, reviewCheckout, saveCheckpoint, workingState, worktreeAtCheckpoint } from './git-checkpoint';

let root: string;
let remote: string;
let laptop: string;
let mini: string;
let worktree: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();
const write = (dir: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
function clone(name: string) {
  const dir = path.join(root, name);
  git(root, 'clone', '-q', remote, dir);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  return dir;
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-checkpoint-')));
  remote = path.join(root, 'remote.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  const seed = clone('seed');
  write(seed, 'README.md', '# demo\n');
  write(seed, '.gitignore', 'node_modules/\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'first');
  git(seed, 'push', '-q', 'origin', 'main');
  laptop = clone('laptop');
  mini = clone('mini');
  // The execution's worktree on the laptop, on its own branch.
  worktree = path.join(root, 'laptop-worktrees', 'demo-1');
  git(laptop, 'worktree', 'add', '-q', '-b', 'demo/fix-login', worktree, 'main');
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('saving a checkpoint', () => {
  it('commits tracked changes and the chosen untracked files, pushes without force, and leaves secrets', async () => {
    write(worktree, 'README.md', '# demo, edited\n');
    write(worktree, 'src/login.ts', 'export {};\n');
    write(worktree, 'scratch.txt', 'not wanted\n');
    write(worktree, '.env.local', 'SECRET=1\n');
    write(worktree, 'node_modules/x/index.js', '');
    const state = await workingState(worktree, ['.env*']);
    expect(state).toMatchObject({ branch: 'demo/fix-login', changed: ['README.md'] });
    expect(state.untracked.sort()).toEqual(['scratch.txt', 'src/login.ts']);
    expect(state.localOnly).toEqual(['.env.local']);

    const saved = await saveCheckpoint({ worktree, message: 'Checkpoint before continuing on Mac Mini', includeUntracked: ['src/login.ts'], filesToCopy: ['.env*'] });
    expect(saved).toMatchObject({ branch: 'demo/fix-login', remote: 'origin', committed: true });
    expect(saved.files.sort()).toEqual(['README.md', 'src/login.ts']);
    expect(git(remote, 'rev-parse', 'refs/heads/demo/fix-login')).toBe(saved.sha);
    expect(git(worktree, 'status', '--porcelain').split('\n').sort()).toEqual(['?? .env.local', '?? scratch.txt']);
    // Again after a crash: nothing new to commit, still published.
    expect(await saveCheckpoint({ worktree, message: 'again', includeUntracked: [] })).toMatchObject({ sha: saved.sha, committed: false });
  });

  it('refuses a secret or an ignored file, and a push that would need force', async () => {
    write(worktree, '.env.local', 'SECRET=1\n');
    await expect(saveCheckpoint({ worktree, message: 'x', includeUntracked: ['.env.local'] })).rejects.toMatchObject({ code: 'invalid_untracked' });
    // Someone else pushed to the same branch.
    await saveCheckpoint({ worktree, message: 'first save', includeUntracked: [] });
    const other = path.join(root, 'other-wt');
    git(mini, 'fetch', '-q', 'origin');
    git(mini, 'worktree', 'add', '-q', '-b', 'demo/fix-login', other, 'origin/main');
    write(other, 'OTHER.md', 'x\n');
    git(other, 'add', '.');
    git(other, 'commit', '-q', '-m', 'other');
    git(other, 'push', '-q', '--force', 'origin', 'demo/fix-login');
    write(worktree, 'README.md', 'mine\n');
    const err = await saveCheckpoint({ worktree, message: 'mine', includeUntracked: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(CheckpointError);
    expect(err.code).toBe('push_rejected');
    // Nothing forced: the remote keeps the other commit.
    expect(git(remote, 'log', '--format=%s', '-1', 'refs/heads/demo/fix-login')).toBe('other');
  });
});

describe('the destination', () => {
  it('builds its worktree at the exact commit, on the branch, tracking the remote', async () => {
    write(worktree, 'src/login.ts', 'export {};\n');
    const saved = await saveCheckpoint({ worktree, message: 'save', includeUntracked: ['src/login.ts'] });
    const target = path.join(root, 'mini-worktrees', 'demo-1');
    const made = await worktreeAtCheckpoint({ repo: mini, path: target, checkpoint: saved });
    expect(made).toEqual({ path: target, branch: 'demo/fix-login', sha: saved.sha });
    expect(fs.readFileSync(path.join(target, 'src/login.ts'), 'utf8')).toBe('export {};\n');
    expect(git(target, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/demo/fix-login');
    // Retried: the same worktree.
    expect(await worktreeAtCheckpoint({ repo: mini, path: target, checkpoint: saved })).toEqual(made);
  });

  it("won't take a branch that moved, a branch with other commits, or one checked out elsewhere", async () => {
    write(worktree, 'README.md', 'saved\n');
    const saved = await saveCheckpoint({ worktree, message: 'save', includeUntracked: [] });
    const moved = { ...saved, sha: git(remote, 'rev-parse', 'refs/heads/main') };
    await expect(worktreeAtCheckpoint({ repo: mini, path: path.join(root, 'a'), checkpoint: moved })).rejects.toMatchObject({ code: 'checkpoint_mismatch' });

    // A branch of the same name here with a commit of its own.
    git(mini, 'branch', 'demo/fix-login', 'origin/main');
    const side = path.join(root, 'side');
    git(mini, 'worktree', 'add', '-q', side, 'demo/fix-login');
    write(side, 'MINE.md', 'x\n');
    git(side, 'add', '.');
    git(side, 'commit', '-q', '-m', 'mine');
    await expect(worktreeAtCheckpoint({ repo: mini, path: path.join(root, 'b'), checkpoint: saved })).rejects.toMatchObject({ code: 'branch_in_use' });
    git(mini, 'worktree', 'remove', side);
    await expect(worktreeAtCheckpoint({ repo: mini, path: path.join(root, 'c'), checkpoint: saved })).rejects.toMatchObject({ code: 'divergent_branch' });
    expect(git(mini, 'log', '--format=%s', '-1', 'demo/fix-login')).toBe('mine');
  });

  it('moves a branch that is only behind forward to the checkpoint', async () => {
    git(mini, 'branch', 'demo/fix-login', 'origin/main');
    write(worktree, 'NEW.md', 'x\n');
    const saved = await saveCheckpoint({ worktree, message: 'save', includeUntracked: ['NEW.md'] });
    const made = await worktreeAtCheckpoint({ repo: mini, path: path.join(root, 'd'), checkpoint: saved });
    expect(made.sha).toBe(saved.sha);
  });
});

describe('a review checkout', () => {
  it('opens the published commit on its own, refreshes while clean, and keeps edits', async () => {
    const first = await saveCheckpoint({ worktree, message: 'one', includeUntracked: [] });
    const review = path.join(root, 'review', 'demo-1');
    expect(await reviewCheckout({ repo: mini, path: review, checkpoint: first })).toMatchObject({ created: true, sha: first.sha });
    expect(git(review, 'branch', '--show-current')).toBe('');
    write(worktree, 'README.md', 'two\n');
    const second = await saveCheckpoint({ worktree, message: 'two', includeUntracked: [] });
    expect(await reviewCheckout({ repo: mini, path: review, checkpoint: second })).toMatchObject({ refreshed: true, sha: second.sha });
    write(review, 'README.md', 'my own edit\n');
    write(worktree, 'README.md', 'three\n');
    const third = await saveCheckpoint({ worktree, message: 'three', includeUntracked: [] });
    expect(await reviewCheckout({ repo: mini, path: review, checkpoint: third })).toMatchObject({ refreshed: false, dirty: true, sha: second.sha });
    expect(fs.readFileSync(path.join(review, 'README.md'), 'utf8')).toBe('my own edit\n');
  });
});
