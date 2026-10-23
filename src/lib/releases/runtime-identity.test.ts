import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runtimeRepository } from './runtime-identity';

let scratch: string;
let checkout: string;
const argv = process.argv;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-runtime-repo-'));
  checkout = path.join(scratch, 'checkout');
  fs.mkdirSync(path.join(checkout, 'dist/cli'), { recursive: true });
  fs.writeFileSync(path.join(checkout, 'dist/cli/index.mjs'), '');
  vi.stubEnv('RI_RUNTIME_REPO', undefined);
});

afterEach(() => {
  process.argv = argv;
  vi.unstubAllEnvs();
  fs.rmSync(scratch, { recursive: true, force: true });
});

it('finds the checkout of a CLI run from another folder', () => {
  process.argv = [process.execPath, path.join(checkout, 'dist/cli/index.mjs')];
  expect(runtimeRepository()).toBe(fs.realpathSync(checkout));
});

it('follows a global link to the checkout it points at', () => {
  // `pnpm add -g link:<checkout>` runs the entry through global/v11/<hash>/node_modules.
  const linked = path.join(scratch, 'global/node_modules/ai-task-manager');
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  fs.symlinkSync(checkout, linked);
  process.argv = [process.execPath, path.join(linked, 'dist/cli/index.mjs')];
  expect(runtimeRepository()).toBe(fs.realpathSync(checkout));
});

it('prefers an explicit runtime and keeps the project folder for source runs', () => {
  vi.stubEnv('RI_RUNTIME_REPO', '/runtime');
  process.argv = [process.execPath, path.join(checkout, 'dist/cli/index.mjs')];
  expect(runtimeRepository()).toBe('/runtime');
  vi.stubEnv('RI_RUNTIME_REPO', undefined);
  process.argv = [process.execPath, path.join(checkout, 'src/cli/index.ts')];
  expect(runtimeRepository()).toBe(process.cwd());
});
