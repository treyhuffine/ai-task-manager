import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serverBaseUrl } from './server-client';
import { PUBLIC_BASE_URL_ENV, publishServerRuntime } from '@/lib/server-runtime/record';

let tmpRoot: string;
const saved = { port: process.env.PORT, pub: process.env[PUBLIC_BASE_URL_ENV], work: process.env.FLOW_WORK_DIR };

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-sc-'));
  process.env.FLOW_WORK_DIR = path.join(tmpRoot, '.work');
  delete process.env.PORT;
  delete process.env[PUBLIC_BASE_URL_ENV];
});

afterEach(() => {
  if (saved.port === undefined) delete process.env.PORT;
  else process.env.PORT = saved.port;
  if (saved.pub === undefined) delete process.env[PUBLIC_BASE_URL_ENV];
  else process.env[PUBLIC_BASE_URL_ENV] = saved.pub;
  if (saved.work === undefined) delete process.env.FLOW_WORK_DIR;
  else process.env.FLOW_WORK_DIR = saved.work;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('serverBaseUrl — internal self-call routing', () => {
  it('targets the private HTTP loopback in the gateway server process (never public HTTPS)', () => {
    process.env[PUBLIC_BASE_URL_ENV] = 'https://localhost:4224';
    process.env.PORT = '53000';
    expect(serverBaseUrl()).toBe('http://127.0.0.1:53000');
  });

  it('uses the recorded private upstream out of process under HTTP/2', () => {
    publishServerRuntime({
      version: 1,
      runId: 'r1',
      launcherPid: process.pid,
      startedAt: new Date().toISOString(),
      mode: 'https',
      http2: true,
      publicBaseUrl: 'https://localhost:4224',
      publicPort: 4224,
      privateUpstreams: { next: 'http://127.0.0.1:53111' },
    });
    expect(serverBaseUrl()).toBe('http://127.0.0.1:53111');
  });

  it('ignores a stale HTTPS record whose launcher is dead (e.g. after switching to HTTP)', () => {
    publishServerRuntime({
      version: 1,
      runId: 'stale',
      launcherPid: 0x7ffffffe, // not a live PID
      startedAt: new Date().toISOString(),
      mode: 'https',
      http2: true,
      publicBaseUrl: 'https://localhost:4224',
      publicPort: 4224,
      privateUpstreams: { next: 'http://127.0.0.1:59999' },
    });
    const base = serverBaseUrl();
    // Must NOT follow the dead record's private upstream; falls back to local HTTP.
    expect(base).not.toBe('http://127.0.0.1:59999');
    expect(base.startsWith('https://')).toBe(false);
  });

  it('falls back to the local base URL for direct HTTP (no gateway)', () => {
    const base = serverBaseUrl();
    expect(base.startsWith('http://')).toBe(true);
    expect(base.startsWith('https://')).toBe(false);
  });
});
