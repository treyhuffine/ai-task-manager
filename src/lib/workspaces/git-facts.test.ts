import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { gitFactsAt } from './index';

/** What an agent's record should say about git, read from a folder it's moving to. */

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-git-facts-')));
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const sh = (cwd: string, cmd: string) =>
  execSync(cmd, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@b', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@b' } })
    .toString().trim();

/** A repo with one commit on main, tracking main on origin. */
function tracked(name: string): string {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir);
  sh(dir, 'git init -q -b main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  sh(dir, 'git add -A && git commit -qm init && git update-ref refs/remotes/origin/main HEAD');
  return dir;
}

const plainAgent = { isGit: false, baseBranch: null, remoteName: null, worktreeRoot: null };

describe('gitFactsAt', () => {
  it('finds a repository for an agent that had none, as a new agent would', async () => {
    expect(await gitFactsAt(tracked('becomes-git'), plainAgent)).toEqual({
      isGit: true, baseBranch: 'main', remoteName: 'origin', worktreeRoot: null,
    });
  });

  it('clears everything only a git agent has when the folder is not a repository', async () => {
    const dir = path.join(ROOT, 'no-longer-git');
    fs.mkdirSync(dir);
    expect(await gitFactsAt(dir, { isGit: true, baseBranch: 'main', remoteName: 'origin', worktreeRoot: '/worktrees' })).toEqual(plainAgent);
  });

  it('keeps what the agent chose when it still means something there: the same repo, moved', async () => {
    const dir = tracked('moved');
    sh(dir, 'git branch develop && git update-ref refs/remotes/upstream/release HEAD');
    const chosen = { isGit: true, remoteName: 'upstream', worktreeRoot: '/worktrees' };
    expect(await gitFactsAt(dir, { ...chosen, baseBranch: 'develop' })).toEqual({ ...chosen, baseBranch: 'develop' });
    expect(await gitFactsAt(dir, { ...chosen, baseBranch: 'release' })).toEqual({ ...chosen, baseBranch: 'release' });
  });

  it('finds the base branch again in a repo that does not have the old one', async () => {
    expect((await gitFactsAt(tracked('another-repo'), { isGit: true, baseBranch: 'develop', remoteName: 'origin', worktreeRoot: null })).baseBranch).toBe('main');
  });

  it('calls a folder inside a repository plain, as a new agent would', async () => {
    const dir = path.join(tracked('outer'), 'inner');
    fs.mkdirSync(dir);
    expect((await gitFactsAt(dir, plainAgent)).isGit).toBe(false);
  });
});
