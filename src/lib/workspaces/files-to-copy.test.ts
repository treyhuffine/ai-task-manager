/**
 * `filesToCopy` brings a folder's local files (gitignored `.env*` by default)
 * into each new worktree. It used to copy every match, tracked files too, so
 * a committed `.env.example` was overwritten with the source folder's version.
 * That folder is often behind the remote the worktree was rooted at, or on
 * another branch, so the copy showed up as a change (or an untracked file)
 * nobody made, in every new worktree. Tracked files are git's to place.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitFixture, git, type GitFixture } from '@/test/fixtures/git';
import { copyFilesToWorktree, previewFilesToCopy } from './files-to-copy';
import { detectSourceWip } from './wip';

vi.setConfig({ testTimeout: 30_000 });

let fixture: GitFixture;
let remote: string;
let source: string;

beforeEach(() => {
  fixture = createGitFixture();
  remote = fixture.remote('app', {
    '.gitignore': '.env*\n!.env.example\n',
    '.env.example': 'API_KEY=\n',
    'package.json': '{"name":"app"}\n',
  });
  source = fixture.clone(remote, path.join(fixture.base, 'source'));
  write(source, '.env.local', 'API_KEY=secret\n');
});

afterEach(() => fixture.cleanup());

function write(dir: string, rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
}

function read(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

/** Upstream moves on without the source folder pulling. */
function advanceRemote(files: Record<string, string>): void {
  const other = fixture.clone(remote, path.join(fixture.base, `other-${Date.now()}`));
  fixture.commit(other, files, 'upstream change');
  git(other, 'push', '-q', 'origin', 'main');
}

/** A worktree rooted at the fresh remote main, as a new execution's is. */
function worktreeAtRemoteMain(name = 'wt'): string {
  git(source, 'fetch', '-q', 'origin');
  const wt = path.join(fixture.base, name);
  git(source, 'worktree', 'add', '-q', '-b', `exec/${name}`, wt, 'origin/main');
  return wt;
}

describe('copyFilesToWorktree', () => {
  it("leaves a tracked .env.example at the worktree's base when the source folder is behind", async () => {
    advanceRemote({ '.env.example': 'API_KEY=\nNEW_FLAG=true\n' });
    const wt = worktreeAtRemoteMain();

    const copied = await copyFilesToWorktree(source, wt, ['.env*']);

    expect(copied).toBe(1);
    expect(read(wt, '.env.local')).toBe('API_KEY=secret\n');
    expect(read(wt, '.env.example')).toBe('API_KEY=\nNEW_FLAG=true\n');
    expect(git(wt, 'status', '--porcelain')).toBe('');
  });

  it("doesn't bring a file the source folder's branch tracks into a worktree whose base lacks it", async () => {
    git(source, 'checkout', '-q', '-b', 'feature');
    fixture.commit(source, { 'apps/web/.env.example': 'WEB_URL=\n' }, 'feature env');
    const wt = worktreeAtRemoteMain();

    await copyFilesToWorktree(source, wt, ['.env*']);

    expect(fs.existsSync(path.join(wt, 'apps/web/.env.example'))).toBe(false);
    expect(git(wt, 'status', '--porcelain')).toBe('');
  });

  it("doesn't carry an uncommitted edit to a tracked file", async () => {
    write(source, '.env.example', 'API_KEY=\nLOCAL_EDIT=1\n');
    const wt = worktreeAtRemoteMain();

    await copyFilesToWorktree(source, wt, ['.env*']);

    expect(read(wt, '.env.example')).toBe('API_KEY=\n');
    expect(git(wt, 'status', '--porcelain')).toBe('');
  });

  it('still copies untracked local files at any depth, ignored or not', async () => {
    write(source, 'apps/web/.env.local', 'WEB=1\n');
    write(source, '.envrc', 'use node\n');
    fs.writeFileSync(path.join(source, '.gitignore'), '.env.local\napps/web/.env.local\n');
    const wt = worktreeAtRemoteMain();

    const copied = await copyFilesToWorktree(source, wt, ['.env*']);

    expect(copied).toBe(3);
    expect(read(wt, '.env.local')).toBe('API_KEY=secret\n');
    expect(read(wt, 'apps/web/.env.local')).toBe('WEB=1\n');
    expect(read(wt, '.envrc')).toBe('use node\n');
  });

  it('copies every match when neither folder is a git checkout', async () => {
    const plain = path.join(fixture.base, 'plain');
    const dest = path.join(fixture.base, 'dest');
    write(plain, '.env.example', 'A=\n');
    write(plain, '.env', 'A=1\n');
    fs.mkdirSync(dest);

    expect(await copyFilesToWorktree(plain, dest, ['.env*'])).toBe(2);
    expect(read(dest, '.env.example')).toBe('A=\n');
  });

  it('checks tracked paths in batches, so a broad pattern copies everything untracked', async () => {
    for (let i = 0; i < 450; i++) write(source, `local/${String(i).padStart(3, '0')}.env.local`, `${i}\n`);
    const wt = worktreeAtRemoteMain();

    const copied = await copyFilesToWorktree(source, wt, ['*.env.local', '.env*']);

    expect(copied).toBe(451);
    expect(read(wt, 'local/449.env.local')).toBe('449\n');
    expect(read(wt, '.env.example')).toBe('API_KEY=\n');
  });
});

describe('previewFilesToCopy', () => {
  it('lists only the files a worktree would receive', async () => {
    write(source, 'apps/web/.env.local', 'WEB=1\n');

    const preview = await previewFilesToCopy(source, ['.env*']);

    expect(preview).toEqual({ files: ['.env.local', 'apps/web/.env.local'], truncated: false });
  });

  it("doesn't let tracked matches use up the cap", async () => {
    fixture.commit(source, { 'a/.env.example': 'A=\n', 'b/.env.example': 'B=\n' }, 'more examples');
    write(source, 'z/.env.local', 'Z=1\n');

    const preview = await previewFilesToCopy(source, ['.env*'], { maxFiles: 2 });

    expect(preview).toEqual({ files: ['.env.local', 'z/.env.local'], truncated: true });
  });
});

describe('detectSourceWip', () => {
  it('reports an edit to a tracked file the patterns match, since the copy no longer carries it', async () => {
    write(source, '.env.example', 'API_KEY=\nLOCAL_EDIT=1\n');
    write(source, '.env.unignored', 'X=1\n');
    fs.writeFileSync(path.join(source, '.gitignore'), '.env.local\n');

    const wip = await detectSourceWip(source, ['.env*']);

    expect(wip.modified.sort()).toEqual(['.env.example', '.gitignore']);
    expect(wip.untracked).toEqual([]);
  });
});
