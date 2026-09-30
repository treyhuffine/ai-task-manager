import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitSkillPaths, currentBranch, isGitRepo, uncommittedSkillNames } from './git';

let repo: string;
const IDENTITY = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
const saved: Record<string, string | undefined> = {};

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, env: { ...process.env, ...IDENTITY } }).toString();
}

function write(rel: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), content);
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-git-'));
  for (const [k, v] of Object.entries(IDENTITY)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  git('init', '--quiet', '--initial-branch=main');
  write('README.md', 'hi\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'init');
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('project skill git', () => {
  it('knows a repo and its branch', async () => {
    expect(await isGitRepo(repo)).toBe(true);
    expect(await currentBranch(repo)).toBe('main');
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-plain-'));
    try {
      expect(await isGitRepo(plain)).toBe(false);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it('names the skills with uncommitted changes', async () => {
    write('.claude/skills/deploy/SKILL.md', '---\nname: deploy\n---\n');
    write('.claude/skills/review/SKILL.md', '---\nname: review\n---\n');
    git('add', '.claude/skills/review');
    git('commit', '--quiet', '-m', 'review');
    write('.claude/skills/review/references/x.md', 'x');
    write('src/app.ts', 'unrelated');
    expect([...(await uncommittedSkillNames(repo))].sort()).toEqual(['deploy', 'review']);
  });

  it("commits one skill's paths and leaves everything else as it was, staged or not", async () => {
    write('.claude/skills/deploy/SKILL.md', '---\nname: deploy\n---\n');
    fs.mkdirSync(path.join(repo, '.agents', 'skills'), { recursive: true });
    fs.symlinkSync('../../.claude/skills/deploy', path.join(repo, '.agents', 'skills', 'deploy'));
    write('.claude/skills/other/SKILL.md', '---\nname: other\n---\n');
    write('staged.txt', 'staged');
    git('add', 'staged.txt');

    const commit = await commitSkillPaths(repo, 'deploy', ['.claude/skills/deploy', '.agents/skills/deploy']);
    expect(commit).toMatchObject({ branch: 'main', message: 'Add the deploy skill' });
    expect(git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual([
      '.agents/skills/deploy',
      '.claude/skills/deploy/SKILL.md',
    ]);
    expect(git('status', '--porcelain').trim().split('\n').sort()).toEqual(['?? .claude/skills/other/', 'A  staged.txt']);
    expect(await uncommittedSkillNames(repo)).toEqual(new Set(['other']));
  });

  it('says Update for a skill the repo already has, and refuses when nothing changed', async () => {
    write('.claude/skills/deploy/SKILL.md', 'v1');
    await commitSkillPaths(repo, 'deploy', ['.claude/skills/deploy']);
    await expect(commitSkillPaths(repo, 'deploy', ['.claude/skills/deploy'])).rejects.toMatchObject({ code: 'invalid' });
    write('.claude/skills/deploy/SKILL.md', 'v2');
    expect((await commitSkillPaths(repo, 'deploy', ['.claude/skills/deploy'])).message).toBe('Update the deploy skill');
  });

  it('commits a removal', async () => {
    write('.claude/skills/deploy/SKILL.md', 'v1');
    await commitSkillPaths(repo, 'deploy', ['.claude/skills/deploy']);
    fs.rmSync(path.join(repo, '.claude', 'skills', 'deploy'), { recursive: true });
    await commitSkillPaths(repo, 'deploy', ['.claude/skills/deploy', '.agents/skills/deploy']);
    expect(git('ls-files', '.claude/skills').trim()).toBe('');
  });

  it('refuses outside a repo', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-plain-'));
    try {
      await expect(commitSkillPaths(plain, 'x', ['.claude/skills/x'])).rejects.toMatchObject({ code: 'invalid' });
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
