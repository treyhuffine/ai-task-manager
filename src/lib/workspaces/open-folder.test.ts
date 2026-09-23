import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { openFolderHandle } from './index';
import { listTree } from './list-tree';
import { readBaseFile } from './read-file';

/**
 * `openFolderHandle` opens a folder the user owns (an agent's own folder)
 * with an explicit base, never agentex's worktree metadata, which for a
 * main checkout resolves against the server's cwd (see the function's doc).
 */

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-open-folder-')));
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const sh = (cwd: string, cmd: string) =>
  execSync(cmd, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@b', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@b' } })
    .toString().trim();

function repo(name: string): string {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir);
  sh(dir, 'git init -q -b main');
  return dir;
}

describe('openFolderHandle', () => {
  it('bases a checkout on its own HEAD, whatever metadata the server cwd carries', async () => {
    const dir = repo('committed');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    sh(dir, 'git add -A && git commit -qm init');
    const head = sh(dir, 'git rev-parse HEAD');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');

    const handle = await openFolderHandle(dir);
    expect(handle?.kind).toBe('git');
    if (handle?.kind !== 'git') return;
    expect(handle.git.baseSha).toBe(head);
    expect(handle.git.base).toBe('main');
    expect(await readBaseFile(handle, 'a.txt')).toBe('one\n');
    expect((await listTree(handle)).find((e) => e.path === 'a.txt')?.status).toBeTruthy();
  });

  it('opens a repo with no commits yet, every file reading as new', async () => {
    const dir = repo('unborn');
    fs.writeFileSync(path.join(dir, 'draft.md'), '# hi\n');
    const handle = await openFolderHandle(dir);
    expect(handle?.kind).toBe('git');
    if (handle?.kind !== 'git') return;
    expect((await listTree(handle)).map((e) => e.path)).toContain('draft.md');
    expect(await readBaseFile(handle, 'draft.md')).toBe('');
  });

  it('returns null for a detached HEAD, which agentex cannot open', async () => {
    const dir = repo('detached');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    sh(dir, 'git add -A && git commit -qm init && git checkout -q --detach');
    expect(await openFolderHandle(dir)).toBeNull();
  });

  it('opens a plain folder bare, and returns null for one that is gone', async () => {
    const dir = path.join(ROOT, 'plain');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'x');
    const handle = await openFolderHandle(dir);
    expect(handle?.kind).toBe('bare');
    expect(await openFolderHandle(path.join(ROOT, 'missing'))).toBeNull();
  });
});
