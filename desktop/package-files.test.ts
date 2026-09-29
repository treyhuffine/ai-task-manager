import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rebaseResourceLinks } from './package-files.mjs';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
it('preserves pnpm links after the staging folder is removed and refuses external dependencies', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-package-links-')); dirs.push(temp);
  const source = path.join(temp, 'stage'); const output = path.join(temp, 'Resources');
  fs.mkdirSync(path.join(source, 'server/node_modules/.pnpm/dep'), { recursive: true });
  fs.writeFileSync(path.join(source, 'server/node_modules/.pnpm/dep/index.js'), 'portable');
  fs.symlinkSync('.pnpm/dep', path.join(source, 'server/node_modules/dep'));
  fs.cpSync(source, output, { recursive: true });
  expect(rebaseResourceLinks(output, source)).toBe(1);
  fs.rmSync(source, { recursive: true });
  expect(fs.readFileSync(path.join(output, 'server/node_modules/dep/index.js'), 'utf8')).toBe('portable');
  fs.mkdirSync(source);
  fs.symlinkSync(temp, path.join(output, 'outside'));
  expect(() => rebaseResourceLinks(output, source)).toThrow('escapes resources');
});
