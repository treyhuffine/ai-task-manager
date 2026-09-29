import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as tar from 'tar';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { validateRuntimeArchive } from './release';
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-archive-test-')); fs.mkdirSync(path.join(root, 'server')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
async function archive(files = ['server']) {
  const file = path.join(root, 'test.tar.gz'); await tar.c({ file, cwd: root, gzip: true }, files); return file;
}
it('accepts bounded ordinary files and rejects unpacked overflow', async () => {
  fs.writeFileSync(path.join(root, 'server/file'), '12345');
  const file = await archive(); await expect(validateRuntimeArchive(file, 5)).resolves.toBeUndefined();
  await expect(validateRuntimeArchive(file, 4)).rejects.toThrow('signed unpacked size');
});
it('rejects escaping symbolic links before extraction', async () => {
  fs.symlinkSync('../../outside', path.join(root, 'server/link'));
  await expect(validateRuntimeArchive(await archive(), 100)).rejects.toThrow('escapes');
});
it('rejects symlink-ancestor traversal before extraction', async () => {
  fs.mkdirSync(path.join(root, 'server/dir'));
  fs.symlinkSync('..', path.join(root, 'server/dir/up'));
  fs.symlinkSync('dir/up/../../external', path.join(root, 'server/escape'));
  fs.writeFileSync(path.join(root, 'server/external'), 'lexical decoy');
  await expect(validateRuntimeArchive(await archive(), 100)).rejects.toThrow('Unsafe runtime symbolic link');
});
it('accepts package links whose parent components precede named components', async () => {
  fs.mkdirSync(path.join(root, 'node/bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node/bin/node'), 'node');
  fs.mkdirSync(path.join(root, 'server/packages/nested'), { recursive: true });
  fs.symlinkSync('../../../node/bin/node', path.join(root, 'server/packages/nested/dependency'));
  await expect(validateRuntimeArchive(await archive(['node', 'server']), 100)).resolves.toBeUndefined();
});
it('rejects unexpected paths and duplicate entries', async () => {
  fs.writeFileSync(path.join(root, 'secret'), 'x');
  await expect(validateRuntimeArchive(await archive(['secret']), 100)).rejects.toThrow('path');
  fs.writeFileSync(path.join(root, 'server/file'), 'x');
  await expect(validateRuntimeArchive(await archive(['server/file', 'server/file']), 100)).rejects.toThrow('Duplicate');
});
