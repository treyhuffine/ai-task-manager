import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearServerRuntimeIfOwned,
  isProcessAlive,
  newRunId,
  publishServerRuntime,
  readLiveServerRuntime,
  readServerRuntime,
  type ServerRuntimeRecord,
} from './record';

let tmpRoot: string;

function makeRecord(overrides: Partial<ServerRuntimeRecord> = {}): ServerRuntimeRecord {
  return {
    version: 1,
    runId: newRunId(),
    launcherPid: process.pid,
    startedAt: new Date().toISOString(),
    mode: 'https',
    http2: true,
    publicBaseUrl: 'https://localhost:4224',
    publicPort: 4224,
    privateUpstreams: { next: 'http://127.0.0.1:53000' },
    ...overrides,
  };
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-rec-'));
  process.env.RI_WORK_DIR = path.join(tmpRoot, '.work');
});

afterAll(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(path.join(tmpRoot, '.work', 'server-runtime.json'), { force: true });
});

describe('server-runtime record', () => {
  it('publishes and reads back the record', () => {
    const rec = makeRecord();
    publishServerRuntime(rec);
    expect(readServerRuntime()).toEqual(rec);
  });

  it('treats a dead-launcher record as not live', () => {
    // 0x7ffffffe is not a real PID on any platform we target.
    publishServerRuntime(makeRecord({ launcherPid: 0x7ffffffe }));
    expect(readServerRuntime()).not.toBeNull();
    expect(readLiveServerRuntime()).toBeNull();
  });

  it('treats a live-launcher record as live', () => {
    publishServerRuntime(makeRecord({ launcherPid: process.pid }));
    expect(readLiveServerRuntime()).not.toBeNull();
  });

  it('clears only when the run ID matches (never a newer instance)', () => {
    const rec = makeRecord();
    publishServerRuntime(rec);
    clearServerRuntimeIfOwned('some-other-run-id');
    expect(readServerRuntime()).not.toBeNull();
    clearServerRuntimeIfOwned(rec.runId);
    expect(readServerRuntime()).toBeNull();
  });

  it('rejects a malformed record file', () => {
    fs.writeFileSync(path.join(tmpRoot, '.work', 'server-runtime.json'), '{ not valid json');
    expect(readServerRuntime()).toBeNull();
  });

  it('isProcessAlive reflects real process state', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(0x7ffffffe)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
  });
});
