import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { launchPluginEvaluation, pluginEvaluationStatus } from './evaluation';

let root: string;
const record = { format: 1, pid: process.pid, key: 'a'.repeat(64), parentOrigin: 'https://ri.example', hostOrigin: 'https://examples.example', sandboxOrigin: 'https://sandbox.example' };
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-evaluation-test-')); vi.stubEnv('RI_MCP_APPS_EVAL_DIR', root); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); fs.rmSync(root, { recursive: true, force: true }); });
function write(value: unknown) { fs.writeFileSync(path.join(root, 'remote.json'), JSON.stringify(value)); }

it('keeps the experiment unavailable for absent, malformed, shared or insecure origins', () => {
  expect(pluginEvaluationStatus().available).toBe(false);
  for (const value of [null, { ...record, hostOrigin: record.parentOrigin }, { ...record, sandboxOrigin: 'http://sandbox.example' }, { ...record, pid: 99999999 }]) {
    write(value); expect(pluginEvaluationStatus().available).toBe(false);
  }
  write(record);
  expect(pluginEvaluationStatus()).toEqual({ available: true, parentOrigin: record.parentOrigin });
  expect(pluginEvaluationStatus()).not.toHaveProperty('key');
});

it('rejects a different embedding origin before minting a demo capability', async () => {
  write(record);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(launchPluginEvaluation('https://another.example')).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
});

it('mints through a fixed local endpoint and returns only the short-lived isolated view', async () => {
  write(record);
  const fetch = vi.fn(async () => Response.json({ token: 'b'.repeat(64), expiresAt: '2026-10-04T17:00:00.000Z' }));
  vi.stubGlobal('fetch', fetch);
  const result = await launchPluginEvaluation(record.parentOrigin);
  expect(fetch.mock.calls[0]).toMatchObject(['http://127.0.0.1:48885/__launch', { method: 'POST', headers: { 'x-ri-evaluation-key': record.key } }]);
  expect(result).toEqual({ url: `${record.hostOrigin}/s/${'b'.repeat(64)}/index.html`, expiresAt: '2026-10-04T17:00:00.000Z' });
  expect(result).not.toHaveProperty('key');
});

it('fails locally if the host is unavailable or returns a malformed capability', async () => {
  write(record);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Connection refused'); }));
  await expect(launchPluginEvaluation(record.parentOrigin)).rejects.toMatchObject({ status: 503 });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ token: '../elsewhere', expiresAt: 'invalid' })));
  await expect(launchPluginEvaluation(record.parentOrigin)).rejects.toThrow();
});
