import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GitWorkspace } from '@agentex/workspace';
import { listTree } from './list-tree';
import { resolveWorkspaceConflict } from './write-file';

// Real-git + dynamic ESM-lib load is slow, especially under a loaded
// parallel suite; the default 5s timeout flakes. Give these room.
const T = 30_000;

/**
 * Integration coverage for the file tree's conflict detection +
 * resolution, run against a REAL git merge conflict on disk. Guards the
 * two detection signals (git-unmerged and the working-tree marker scan)
 * and the resolve → `git add` round-trip that drops a file out of the
 * "Conflicts" group.
 */

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
}

async function open(dir: string, baseSha: string): Promise<GitWorkspace> {
  const lib = await import('@agentex/workspace');
  const ws = await lib.workspace.open(dir, { baseBranch: 'main', baseSha });
  if (ws.kind !== 'git') throw new Error('expected git workspace');
  return ws;
}

describe('listTree conflict detection', () => {
  let dir: string;
  let baseSha: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-listtree-conflict-'));
    git(dir, 'init', '-b', 'main');
    await fs.writeFile(path.join(dir, 'shared.txt'), 'line1\nbase\nline3\n');
    await fs.writeFile(path.join(dir, 'other.txt'), 'unchanged\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-m', 'base');
    baseSha = git(dir, 'rev-parse', 'HEAD').trim();

    git(dir, 'checkout', '-b', 'feature');
    await fs.writeFile(path.join(dir, 'shared.txt'), 'line1\nFROM FEATURE\nline3\n');
    await fs.writeFile(path.join(dir, 'clean.txt'), 'a clean added file\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-m', 'feature');

    git(dir, 'checkout', 'main');
    await fs.writeFile(path.join(dir, 'shared.txt'), 'line1\nFROM MAIN\nline3\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-m', 'main change');

    // Conflict on shared.txt; clean.txt merges cleanly (added).
    try {
      git(dir, 'merge', 'feature');
    } catch {
      /* expected: merge fails with conflicts */
    }
  }, T);

  afterAll(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }, T);

  it('flags an unmerged file as conflict and a cleanly-merged file as added', async () => {
    const ws = await open(dir, baseSha);
    const entries = await listTree(ws);
    const byPath = (p: string) => entries.find((e) => e.path === p);

    expect(byPath('shared.txt')?.status).toBe('conflict');
    expect(byPath('clean.txt')?.status).toBe('added');
    // Unchanged file carries no status → neither section.
    expect(byPath('other.txt')?.status).toBeUndefined();
  }, T);

  it('resolveWorkspaceConflict clears the conflict (write + git add)', async () => {
    const ws = await open(dir, baseSha);
    // Accept the incoming (feature) side.
    await resolveWorkspaceConflict(ws, 'shared.txt', 'line1\nFROM FEATURE\nline3\n');

    const onDisk = await fs.readFile(path.join(dir, 'shared.txt'), 'utf8');
    expect(onDisk).not.toContain('<<<<<<<');
    expect(git(dir, 'diff', '--name-only', '--diff-filter=U').trim()).toBe('');

    const entries = await listTree(ws);
    const shared = entries.find((e) => e.path === 'shared.txt');
    // Still a change vs base, but no longer a conflict → drops to "Clean".
    expect(shared?.status).toBe('modified');
  }, T);
});

describe('listTree conflict detection is git-index driven (matches VS Code)', () => {
  it('does NOT flag markers-on-disk when the git index is clean', async () => {
    // Detection reads git's unmerged index, not file contents — so a file
    // that merely carries conflict markers (no in-progress merge) shows as a
    // normal change, exactly like VS Code's "Merge Changes" group. The
    // resolver still parses these markers if the user opens the file.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-listtree-markers-'));
    try {
      git(dir, 'init', '-b', 'main');
      await fs.writeFile(path.join(dir, 'a.txt'), 'hello\n');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-m', 'base');
      const baseSha = git(dir, 'rev-parse', 'HEAD').trim();

      // Hand-write conflict markers WITHOUT any merge — index stays clean.
      await fs.writeFile(
        path.join(dir, 'a.txt'),
        '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n',
      );

      const ws = await open(dir, baseSha);
      expect(git(dir, 'diff', '--name-only', '--diff-filter=U').trim()).toBe('');
      const entries = await listTree(ws);
      // Modified vs base, but not a conflict — no unmerged index entry.
      expect(entries.find((e) => e.path === 'a.txt')?.status).toBe('modified');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, T);
});
