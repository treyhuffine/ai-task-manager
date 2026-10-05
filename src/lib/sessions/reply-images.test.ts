import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findReplyImage, resolveReplyImagePath } from './reply-images';

let root: string;
let folder: string;
let outside: string;
const nobodyNamedIt = () => false;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-reply-images-')));
  folder = path.join(root, 'worktree');
  outside = path.join(root, 'elsewhere');
  fs.mkdirSync(path.join(folder, 'screenshots'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(folder, 'screenshots', 'home.png'), 'png');
  fs.writeFileSync(path.join(outside, 'shot.png'), 'png');
  fs.writeFileSync(path.join(outside, 'secrets.txt'), 'nope');
  fs.symlinkSync(path.join(outside, 'secrets.txt'), path.join(folder, 'disguised.png'));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('findReplyImage', () => {
  it("serves an image in the chat's folder, by relative or absolute path", async () => {
    for (const p of ['screenshots/home.png', './screenshots/home.png', path.join(folder, 'screenshots', 'home.png')]) {
      const r = await findReplyImage({ folder, elsewhere: null }, p, nobodyNamedIt);
      expect(r).toMatchObject({ ok: true, mime: 'image/png', file: path.join(folder, 'screenshots', 'home.png') });
    }
  });

  it('serves an image outside the folder only when the agent named that exact path', async () => {
    const p = path.join(outside, 'shot.png');
    expect(await findReplyImage({ folder, elsewhere: null }, p, nobodyNamedIt)).toMatchObject({ ok: false, status: 403 });
    expect(await findReplyImage({ folder, elsewhere: null }, p, (t) => t === p)).toMatchObject({ ok: true, file: p });
    // A chat with no folder (Ri's own chat) still shows what its agent named.
    expect(await findReplyImage({ folder: null, elsewhere: null }, p, (t) => t === p)).toMatchObject({ ok: true });
  });

  it('serves images only, judged by the real file, not a link name', async () => {
    const txt = path.join(outside, 'secrets.txt');
    expect(await findReplyImage({ folder, elsewhere: null }, txt, () => true)).toMatchObject({ ok: false, status: 415 });
    expect(await findReplyImage({ folder, elsewhere: null }, 'disguised.png', () => true)).toMatchObject({ ok: false, status: 415 });
  });

  it('says where the file is for a chat on another device, and 404s what is not there', async () => {
    expect(await findReplyImage({ folder, elsewhere: 'MacBook' }, 'screenshots/home.png', () => true)).toEqual({ ok: false, status: 409, error: 'This image is on MacBook.' });
    expect(await findReplyImage({ folder, elsewhere: null }, 'screenshots/gone.png', () => true)).toMatchObject({ ok: false, status: 404 });
    expect(await findReplyImage({ folder: null, elsewhere: null }, 'relative.png', () => true)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('resolveReplyImagePath', () => {
  it('reads file URLs, home-relative and folder-relative paths', () => {
    expect(resolveReplyImagePath('file:///Users/agent/Screen%20Shot.png', null)).toBe('/Users/agent/Screen Shot.png');
    expect(resolveReplyImagePath('~/Desktop/a.png', null)).toBe(path.join(os.homedir(), 'Desktop/a.png'));
    expect(resolveReplyImagePath('../up.png', '/w/t')).toBe('/w/up.png');
    expect(resolveReplyImagePath('/a/../b.png', null)).toBe('/b.png');
  });
});
