/**
 * The listing for a folder git can't list, which can be any folder at all.
 * A home folder's full walk (6.4M items, minutes, gigabytes) ran the server
 * out of memory, so what matters here is where it stops and what it skips.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { treeResponseSchema } from '@/lib/server/remote-contracts';
import { readAgentFolder } from './agent-folder-reads';
import { openFolderHandle } from './index';
import { listTree } from './list-tree';
import { FOLDER_LIST_LIMIT, walkFolder } from './walk-folder';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-walk-folder-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(rel: string) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'x');
}

describe('walkFolder', () => {
  it('lists every file, nested, with / separators', async () => {
    write('README.md');
    write('posts/one/index.md');
    const { paths, truncated } = await walkFolder(root);
    expect(paths.sort()).toEqual(['README.md', 'posts/one/index.md']);
    expect(truncated).toBe(false);
  });

  it('never counts what is inside a heavyweight directory', async () => {
    for (let i = 0; i < 5; i += 1) write(`node_modules/pkg/${i}.js`);
    write('.git/config');
    write('src/app.ts');
    write('src/.next/page.js');
    expect(await walkFolder(root, { limit: 1 })).toEqual({ paths: ['src/app.ts'], truncated: false });
  });

  it('cut short, leaves out the deepest files rather than every later folder', async () => {
    for (let i = 0; i < 5; i += 1) write(`aaa/deep/${i}.md`);
    write('zzz/top.md');
    write('root.md');
    const { paths, truncated } = await walkFolder(root, { limit: 2 });
    expect(paths.sort()).toEqual(['root.md', 'zzz/top.md']);
    expect(truncated).toBe(true);
  });

  it('is not cut short by a folder holding exactly the limit', async () => {
    write('a.md');
    write('b.md');
    expect((await walkFolder(root, { limit: 2 })).truncated).toBe(false);
    write('c.md');
    expect((await walkFolder(root, { limit: 2 })).truncated).toBe(true);
  });

  it('skips symlinks unless asked, and never follows one', async () => {
    write('real/a.md');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-walk-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'escaped.md'), 'x');
      fs.symlinkSync(outside, path.join(root, 'folder-link'));
      fs.symlinkSync(path.join(root, 'real/a.md'), path.join(root, 'file-link'));
      expect((await walkFolder(root)).paths).toEqual(['real/a.md']);
      expect((await walkFolder(root, { symlinks: true })).paths.sort()).toEqual(['file-link', 'folder-link', 'real/a.md']);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('survives an unreadable folder, and one that is gone', async () => {
    write('readable/a.md');
    write('locked/b.md');
    fs.chmodSync(path.join(root, 'locked'), 0o000);
    try {
      expect((await walkFolder(root)).paths).toEqual(['readable/a.md']);
    } finally {
      fs.chmodSync(path.join(root, 'locked'), 0o755);
    }
    expect(await walkFolder(path.join(root, 'missing'))).toEqual({ paths: [], truncated: false });
  });
});

describe("an agent's plain folder, as the Files tab reads it", () => {
  it('stops at the limit and says so, all the way through the contract', async () => {
    for (let i = 0; i <= FOLDER_LIST_LIMIT; i += 1) fs.writeFileSync(path.join(root, `${i}.md`), '');
    const answer = await readAgentFolder(root, [], { kind: 'tree' });
    const body = treeResponseSchema.parse(answer.body);
    expect(body.entries).toHaveLength(FOLDER_LIST_LIMIT);
    expect(body.truncated).toBe(true);
  });

  it('does not read the whole folder first', async () => {
    write('notes/today.md');
    const handle = await openFolderHandle(root);
    expect(handle?.kind).toBe('bare');
    // `tree()` is the library's full walk, the one that took the server down.
    const listing = await listTree({ ...handle!, tree: () => { throw new Error('walked the whole folder'); } });
    expect(listing).toEqual({
      entries: [{ path: 'notes/today.md', name: 'today.md', kind: 'file' }],
      truncated: false,
    });
  });
});
