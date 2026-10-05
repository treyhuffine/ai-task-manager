/**
 * Every tRPC procedure is one perf-log scope, whichever transport carried it:
 * the middleware opens it for a WebSocket call, and leaves an HTTP call to the
 * scope the service host opened under the same label, so nothing counts twice.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { APP_SHORT_ID } from '@/constants/app';
import type { RequestKey } from '@/lib/auth/request-key';

const ENV = [`${APP_SHORT_ID.toUpperCase()}_ROOT`, `${APP_SHORT_ID.toUpperCase()}_DB_PATH`];
const saved: Record<string, string | undefined> = {};
let dir: string;
let logPath: string;
let db: Database.Database;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-trpc-perf-'));
  for (const key of ENV) saved[key] = process.env[key];
  process.env[ENV[0]!] = dir;
  process.env[ENV[1]!] = path.join(dir, 'data.db');
  logPath = path.join(dir, 'perf.jsonl');
  db = new Database(':memory:');
  vi.resetModules();
});

afterEach(async () => {
  const { stopPerfRecorder } = await import('@/lib/perf/recorder');
  stopPerfRecorder();
  db.close();
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

async function setup() {
  const recorder = await import('@/lib/perf/recorder');
  const { router, viewerProcedure } = await import('./init');
  (await import('@/lib/perf/server')).startServerPerfLog({ logPath });
  const app = router({ probe: router({ read: viewerProcedure.query(() => db.prepare('SELECT 1 AS one').get()) }) });
  const key: RequestKey = { apiKeyId: 'key', location: 'home', scope: 'viewer', workerDeviceId: null, sessionChatId: null };
  const caller = app.createCaller({ key, request: new Request('http://localhost/api/trpc/probe.read') });
  const rollup = () => {
    recorder.flushPerfRollup();
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { type: string; labels?: Record<string, { n: number; dbN: number }> });
    return lines.filter((l) => l.type === 'rollup').at(-1)!.labels!;
  };
  return { recorder, caller, rollup };
}

it('opens the procedure scope for a call with none around it, as over WebSocket', async () => {
  const { caller, rollup } = await setup();
  await caller.probe.read();
  const scope = rollup()['trpc:probe.read']!;
  expect(scope.n).toBe(1);
  // The procedure's own statement, plus the activity lease's on its lock database.
  expect(scope.dbN).toBeGreaterThanOrEqual(2);
});

it('counts an HTTP call once, in the scope the service host opened for it', async () => {
  const { recorder, caller, rollup } = await setup();
  await recorder.perfScope('trpc:probe.read', () => caller.probe.read());
  const labels = rollup();
  expect(labels['trpc:probe.read']!.n).toBe(1);
  expect(Object.keys(labels)).toEqual(['trpc:probe.read']);
});
