import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { githubPullUrl, githubRepoFromRemoteUrl, linkedPullUrl } from './remote';

describe('githubRepoFromRemoteUrl', () => {
  it('reads every form git accepts for a github.com remote', () => {
    for (const remote of [
      'git@github.com:treyhuffine/ai-task-manager.git',
      'git@github.com:treyhuffine/ai-task-manager',
      'https://github.com/treyhuffine/ai-task-manager.git',
      'https://github.com/treyhuffine/ai-task-manager',
      'https://github.com/treyhuffine/ai-task-manager/',
      'https://token@github.com/treyhuffine/ai-task-manager.git',
      'ssh://git@github.com/treyhuffine/ai-task-manager.git',
      'ssh://git@github.com:22/treyhuffine/ai-task-manager.git',
      '  git@github.com:treyhuffine/ai-task-manager.git\n',
    ]) {
      expect(githubRepoFromRemoteUrl(remote), remote).toBe('treyhuffine/ai-task-manager');
    }
  });

  it('keeps dots in repo names', () => {
    expect(githubRepoFromRemoteUrl('git@github.com:acme/ballcoach.ai.git')).toBe('acme/ballcoach.ai');
  });

  it('is null for anything not on github.com', () => {
    for (const remote of [
      'git@gitlab.com:o/r.git',
      'https://github.example.com/o/r.git',
      'https://notgithub.com/o/r',
      '/Users/me/repos/r',
      'https://github.com/only-owner',
      '',
    ]) {
      expect(githubRepoFromRemoteUrl(remote), remote).toBeNull();
    }
  });
});

describe('linkedPullUrl', () => {
  const repoWith = (remote: string | null): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-remote-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
    return dir;
  };

  it('builds the PR address from the origin remote', async () => {
    const dir = repoWith('git@github.com:treyhuffine/ai-task-manager.git');
    try {
      expect(await linkedPullUrl(dir, 42)).toBe(githubPullUrl('treyhuffine/ai-task-manager', 42));
      expect(githubPullUrl('treyhuffine/ai-task-manager', 42)).toBe('https://github.com/treyhuffine/ai-task-manager/pull/42');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is null without a GitHub origin or outside a repo', async () => {
    const local = repoWith(null);
    const gitlab = repoWith('git@gitlab.com:o/r.git');
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-remote-'));
    try {
      expect(await linkedPullUrl(local, 1)).toBeNull();
      expect(await linkedPullUrl(gitlab, 1)).toBeNull();
      expect(await linkedPullUrl(plain, 1)).toBeNull();
      expect(await linkedPullUrl(path.join(plain, 'missing'), 1)).toBeNull();
    } finally {
      for (const d of [local, gitlab, plain]) fs.rmSync(d, { recursive: true, force: true });
    }
  });
});
