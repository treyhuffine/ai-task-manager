import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const builder = createRequire(require.resolve('electron-builder'));
const packager = createRequire(builder.resolve('app-builder-lib'));
const { walkAsync } = packager('@electron/osx-sign/dist/cjs/util') as {
  walkAsync(directory: string, ignore?: (file: string) => boolean): Promise<string[]>;
};
const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

it('does not inspect an ignored runtime dependency tree during signing', async () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-signing-walk-'));
  temporary.push(app);
  const ignored = path.join(app, 'server');
  const dependencies = path.join(ignored, 'node_modules');
  fs.mkdirSync(dependencies, { recursive: true });
  const native = path.join(app, 'shell.node');
  fs.writeFileSync(native, Buffer.from([0, 0, 0, 1]));
  fs.writeFileSync(path.join(dependencies, 'dependency.node'), Buffer.from([0, 0, 0, 1]));
  const visited: string[] = [];
  // Match the contents, like the trailing slash in Ri's signIgnore rules.
  const files = await walkAsync(app, file => { visited.push(file); return file.startsWith(`${ignored}${path.sep}`); });
  expect(files).toEqual([native]);
  expect(visited).toContain(ignored);
  expect(visited).not.toContain(path.join(dependencies, 'dependency.node'));
});

it('still discovers a native file when no ignore rule is supplied', async () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-signing-walk-'));
  temporary.push(app);
  const native = path.join(app, 'shell.node');
  fs.writeFileSync(native, Buffer.from([0, 0, 0, 1]));
  expect(await walkAsync(app)).toEqual([native]);
});
