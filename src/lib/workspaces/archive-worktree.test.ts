import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { WorkspaceRecord } from '@/db/types';
import { archiveSessionWorktree, createWorktreeForSession } from './index';
import { uncommittedFilesOf } from './uncommitted-files';

/**
 * Archiving an execution's worktree with real git: what stops it and what
 * doesn't. Archive keeps the branch, so only files git doesn't have yet are
 * at stake. Commits that aren't pushed are safe, and every execution has
 * them: its branch is rooted at origin/main and tracks it, so agentex
 * counts each commit as unpushed.
 */

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-archive-worktree-')));
const ORIGIN = path.join(ROOT, 'origin.git');
const CLONE = path.join(ROOT, 'clone');
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const GIT_ENV = { GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@b', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@b' };
const sh = (cwd: string, cmd: string) => execSync(cmd, { cwd, env: { ...process.env, ...GIT_ENV } }).toString().trim();

const ws = {
  id: 'archive-ws',
  slug: 'archive-ws',
  cwd: CLONE,
  isGit: true,
  baseBranch: 'main',
  remoteName: 'origin',
  worktreeRoot: path.join(ROOT, 'worktrees'),
} as WorkspaceRecord;

let n = 0;
async function worktree(): Promise<{ path: string; branch: string }> {
  const id = `0190a1b2-c3d4-7e5f-8a9b-${String(++n).padStart(12, '0')}`;
  const wt = await createWorktreeForSession({ ws, sessionId: id, sessionLabel: `archive ${n}` });
  return { path: wt.path, branch: sh(wt.path, 'git branch --show-current') };
}

beforeAll(() => {
  Object.assign(process.env, GIT_ENV);
  sh(ROOT, 'git init -q --bare -b main origin.git');
  sh(ROOT, `git clone -q ${ORIGIN} clone`);
  fs.writeFileSync(path.join(CLONE, 'README.md'), '# app\n');
  sh(CLONE, 'git add -A && git commit -qm init && git push -q origin main');
});

describe('archiveSessionWorktree', () => {
  it('archives committed work that was never pushed, and the branch keeps it', async () => {
    const wt = await worktree();
    fs.writeFileSync(path.join(wt.path, 'feature.ts'), 'export const x = 1;\n');
    sh(wt.path, 'git add -A && git commit -qm feature');
    const head = sh(wt.path, 'git rev-parse HEAD');
    // The case agentex refuses on its own: one commit ahead of origin/main.
    expect(sh(wt.path, 'git status --porcelain=v2 --branch')).toContain('# branch.ab +1 -0');

    await archiveSessionWorktree({ session: { worktreePath: wt.path }, sourceCheckoutPath: CLONE });

    expect(fs.existsSync(wt.path)).toBe(false);
    expect(sh(CLONE, `git rev-parse refs/heads/${wt.branch}`)).toBe(head);
  });

  it('refuses work that is not committed, naming the files, before running the teardown', async () => {
    const wt = await worktree();
    fs.writeFileSync(path.join(wt.path, 'README.md'), '# changed\n');
    fs.writeFileSync(path.join(wt.path, 'notes.md'), 'draft\n');
    fs.mkdirSync(path.join(wt.path, 'scratch'));
    fs.writeFileSync(path.join(wt.path, 'scratch', 'a.txt'), 'a\n');
    // Ignored files aren't work: they stay out of the list, as in git status.
    fs.writeFileSync(path.join(wt.path, 'scratch', '.gitignore'), 'build.log\n.gitignore\n');
    fs.writeFileSync(path.join(wt.path, 'scratch', 'build.log'), 'noise\n');
    const marker = path.join(ROOT, `teardown-${n}`);

    const err = await archiveSessionWorktree({
      session: { worktreePath: wt.path },
      sourceCheckoutPath: CLONE,
      teardownCommand: `echo ran > ${JSON.stringify(marker)}`,
    }).catch((e: unknown) => e);

    expect((err as Error).name).toBe('DirtyWorktreeError');
    // A new folder is listed file by file, not folded into `scratch/` as git status does.
    expect(uncommittedFilesOf(err)).toEqual({
      files: [
        { path: 'notes.md', change: 'untracked' },
        { path: 'README.md', change: 'changed' },
        { path: 'scratch/a.txt', change: 'untracked' },
      ],
      omitted: 0,
    });
    // Nothing touched: the worktree, its files, and whatever the teardown would stop.
    expect(fs.readFileSync(path.join(wt.path, 'notes.md'), 'utf8')).toBe('draft\n');
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('refuses a worktree whose only change is unpushed commits plus one new file', async () => {
    const wt = await worktree();
    sh(wt.path, 'git commit -q --allow-empty -m one');
    fs.writeFileSync(path.join(wt.path, 'left.txt'), 'x\n');

    const err = await archiveSessionWorktree({ session: { worktreePath: wt.path }, sourceCheckoutPath: CLONE }).catch((e: unknown) => e);

    expect(uncommittedFilesOf(err)).toEqual({ files: [{ path: 'left.txt', change: 'untracked' }], omitted: 0 });
    expect(fs.existsSync(wt.path)).toBe(true);
  });

  it('removes it anyway when forced, runs the teardown, and keeps the branch', async () => {
    const wt = await worktree();
    sh(wt.path, 'git commit -q --allow-empty -m kept');
    const head = sh(wt.path, 'git rev-parse HEAD');
    fs.writeFileSync(path.join(wt.path, 'gone.txt'), 'x\n');
    const marker = path.join(ROOT, `teardown-${n}`);

    await archiveSessionWorktree({
      session: { worktreePath: wt.path },
      sourceCheckoutPath: CLONE,
      teardownCommand: `echo ran > ${JSON.stringify(marker)}`,
      force: true,
    });

    expect(fs.existsSync(wt.path)).toBe(false);
    expect(fs.existsSync(marker)).toBe(true);
    expect(sh(CLONE, `git rev-parse refs/heads/${wt.branch}`)).toBe(head);
  });

  it('treats a worktree that is already gone as archived', async () => {
    const wt = await worktree();
    sh(CLONE, `git worktree remove --force ${JSON.stringify(wt.path)}`);
    await expect(archiveSessionWorktree({ session: { worktreePath: wt.path }, sourceCheckoutPath: CLONE })).resolves.toBeUndefined();
  });
});
