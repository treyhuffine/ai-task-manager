import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { treeChecksum } from './catalog-checksum';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@x', ...args], { cwd, encoding: 'utf8' }).trim();
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-checksum-'));
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(dir, 'run.sh'), '#!/bin/sh\necho hi\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'empty'), '');
  fs.symlinkSync('src/app.ts', path.join(dir, 'link'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'one');
  return dir;
}

describe('the checksum of an app version', () => {
  it('names its files, whoever committed them and whatever the commit says', async () => {
    const a = repo();
    const sum = await treeChecksum(a, 'HEAD');
    expect(sum).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(await treeChecksum(a, 'HEAD')).toBe(sum);
    // The same files in a different commit, by someone else, with another message.
    git(a, 'commit', '-q', '--amend', '-m', 'another message', '--author', 'Someone <s@x>');
    expect(await treeChecksum(a, 'HEAD')).toBe(sum);
    // A fresh repository with the same files has the same checksum.
    expect(await treeChecksum(repo(), 'HEAD')).toBe(sum);
  });

  it('changes with any file\'s contents, mode, name or link target', async () => {
    const a = repo();
    const base = await treeChecksum(a, 'HEAD');
    const after = async (change: () => void) => { change(); git(a, 'add', '-A'); git(a, 'commit', '-q', '-m', 'x'); return treeChecksum(a, 'HEAD'); };
    const seen = new Set([base]);
    seen.add(await after(() => fs.writeFileSync(path.join(a, 'src', 'app.ts'), 'export const x = 2;\n')));
    seen.add(await after(() => fs.chmodSync(path.join(a, 'src', 'app.ts'), 0o755)));
    seen.add(await after(() => fs.renameSync(path.join(a, 'empty'), path.join(a, 'empty2'))));
    seen.add(await after(() => { fs.rmSync(path.join(a, 'link')); fs.symlinkSync('run.sh', path.join(a, 'link')); }));
    expect(seen.size).toBe(5);
    // Each older version still has its own.
    expect(await treeChecksum(a, 'HEAD~4')).toBe(base);
  });
});
