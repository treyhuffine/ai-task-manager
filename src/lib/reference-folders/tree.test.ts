import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { listReferenceTree } from '@/lib/reference-folders/tree';

// Builds real repos and shells out to git.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Listing for the `@alias` drill-down (docs/reference-folders-spec.md §8).
 * Runs against real folders because the whole point is respecting a repo's
 * own `.gitignore`, which cannot be faked convincingly.
 */
describe('listReferenceTree', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-reftree-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(rel: string, body = 'x\n'): void {
    const full = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }

  function initRepo(): void {
    execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: tmpDir, stdio: 'pipe' });
  }

  it('lists files in a plain folder', async () => {
    write('notes/a.md');
    write('notes/b.md');
    write('top.txt');
    const { entries, truncated } = await listReferenceTree(tmpDir);
    expect(entries.map((e) => e.path).sort()).toEqual(['notes/a.md', 'notes/b.md', 'top.txt']);
    expect(entries.every((e) => e.kind === 'file')).toBe(true);
    expect(truncated).toBe(false);
  });

  it('sets name to the basename', async () => {
    write('deeply/nested/thing.go');
    const { entries } = await listReferenceTree(tmpDir);
    expect(entries[0]).toMatchObject({ path: 'deeply/nested/thing.go', name: 'thing.go' });
  });

  it('prunes heavy directories in a plain folder', async () => {
    write('src/index.ts');
    write('node_modules/lodash/index.js');
    write('dist/bundle.js');
    write('.git/config');
    const { entries } = await listReferenceTree(tmpDir);
    expect(entries.map((e) => e.path)).toEqual(['src/index.ts']);
  });

  it('honours .gitignore in a repo — the reason git listing exists', async () => {
    initRepo();
    write('.gitignore', 'secret.txt\nbuild/\n');
    write('src/main.go');
    write('secret.txt');
    write('build/out.bin');
    const { entries } = await listReferenceTree(tmpDir);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain('src/main.go');
    expect(paths).toContain('.gitignore');
    expect(paths).not.toContain('secret.txt');
    expect(paths).not.toContain('build/out.bin');
  });

  it('includes untracked files, so brand new work is mentionable', async () => {
    initRepo();
    write('tracked.go');
    execFileSync('git', ['add', 'tracked.go'], { cwd: tmpDir, stdio: 'pipe' });
    write('untracked.go');
    const { entries } = await listReferenceTree(tmpDir);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain('tracked.go');
    expect(paths).toContain('untracked.go');
  });

  it('returns sorted paths so the picker order is stable', async () => {
    write('z.txt');
    write('a.txt');
    write('m/n.txt');
    const { entries } = await listReferenceTree(tmpDir);
    const paths = entries.map((e) => e.path);
    expect(paths).toEqual([...paths].sort());
  });

  it('returns empty rather than throwing for a folder that is not there', async () => {
    const { entries, truncated } = await listReferenceTree(path.join(tmpDir, 'missing'));
    expect(entries).toEqual([]);
    expect(truncated).toBe(false);
  });

  it('survives an unreadable subdirectory', async () => {
    write('readable/a.txt');
    const locked = path.join(tmpDir, 'locked');
    fs.mkdirSync(locked);
    fs.writeFileSync(path.join(locked, 'b.txt'), 'x');
    fs.chmodSync(locked, 0o000);
    try {
      const { entries } = await listReferenceTree(tmpDir);
      expect(entries.map((e) => e.path)).toContain('readable/a.txt');
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });

  it('does not follow symlinks out of the folder', async () => {
    write('real/a.txt');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-reftree-out-'));
    fs.writeFileSync(path.join(outside, 'escaped.txt'), 'x');
    try {
      fs.symlinkSync(outside, path.join(tmpDir, 'link'));
      const { entries } = await listReferenceTree(tmpDir);
      expect(entries.map((e) => e.path)).toEqual(['real/a.txt']);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('never writes to the folder it is reading', async () => {
    // Read-only is the whole contract for reference folders, and an earlier
    // design that opened an agentex workspace handle risked touching
    // `.git/info/agentex.json`. Assert the folder is byte-identical after.
    initRepo();
    write('src/main.go');
    const before = execFileSync('git', ['status', '--porcelain'], {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    const gitDirBefore = fs.readdirSync(path.join(tmpDir, '.git')).sort();

    await listReferenceTree(tmpDir);

    const after = execFileSync('git', ['status', '--porcelain'], {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    expect(after).toBe(before);
    expect(fs.readdirSync(path.join(tmpDir, '.git')).sort()).toEqual(gitDirBefore);
    expect(fs.existsSync(path.join(tmpDir, '.git', 'info', 'agentex.json'))).toBe(false);
  });
});
