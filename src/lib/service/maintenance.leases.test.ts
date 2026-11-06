/**
 * Leases hold across processes, which is the only place they matter. The rest of
 * the suite runs in one process, where SQLite enforces them itself, so it can't
 * see POSIX locks being dropped.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fork, type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { exclusiveActivity } from './maintenance';

const require = createRequire(import.meta.url);
const project = process.cwd();
let root: string;
let server: ChildProcess;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-leases-'));
  vi.stubEnv('RI_ROOT', root);
  for (const key of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR']) vi.stubEnv(key, undefined);
  const script = path.join(root, 'server.cjs');
  fs.writeFileSync(script, `
    require(${JSON.stringify(require.resolve('tsx/cjs'))});
    const { beginActivity } = require(${JSON.stringify(path.join(project, 'src/lib/service/maintenance.ts'))});
    const held = [];
    process.on('message', message => {
      if (message === 'turn') held.push(beginActivity());
      if (message === 'request') beginActivity()();
      if (message === 'end') held.splice(0).forEach(release => release());
      process.send('done');
    });
    process.send('ready');
  `);
  server = fork(script, [], { execArgv: [], env: { ...process.env, TSX_TSCONFIG_PATH: path.join(project, 'tsconfig.json') } });
  await new Promise(resolve => server.once('message', resolve));
});
afterEach(() => { server.kill('SIGKILL'); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

const tell = (message: string) => new Promise(resolve => { server.once('message', resolve); server.send(message); });
const free = () => { try { exclusiveActivity()(); return true; } catch { return false; } };

it('keeps a running turn\'s lease through the requests the server handles meanwhile', async () => {
  await tell('turn');
  expect(free()).toBe(false);
  await tell('request');
  expect(free()).toBe(false);
  await tell('request');
  expect(free()).toBe(false);
  await tell('end');
  expect(free()).toBe(true);
}, 30_000);

it('lets go when the process holding it dies', async () => {
  await tell('turn');
  expect(free()).toBe(false);
  const gone = new Promise(resolve => server.once('exit', resolve));
  server.kill('SIGKILL');
  await gone;
  expect(free()).toBe(true);
}, 30_000);
