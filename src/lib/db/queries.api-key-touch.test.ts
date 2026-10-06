/**
 * `touchApiKey` records a key's use at most once a minute per key while it
 * keeps coming from the same place. Every authenticated request calls it, and
 * the write is what a request waits on whenever another process holds the
 * database's write lock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';

describe('touchApiKey', () => {
  let tmpDir: string;
  const appRootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
  const dbPathEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
  const mirrorDisabledEnv = `${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED`;
  const saveEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-key-touch-'));
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) saveEnv[k] = process.env[k];
    process.env[appRootEnv] = tmpDir;
    process.env[dbPathEnv] = path.join(tmpDir, 'data.db');
    process.env[mirrorDisabledEnv] = '1';
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) {
      if (saveEnv[k] === undefined) delete process.env[k];
      else process.env[k] = saveEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const T0 = Date.UTC(2026, 9, 6, 15, 0, 0);
  const at = (ms: number) => new Date(T0 + ms).toISOString();

  async function setup() {
    const q = await import('@/lib/db/queries');
    const key = q.createApiKey({ name: 'Laptop', deviceId: null, role: 'sign_in' }).key;
    const from = { ip: '10.0.0.2', userAgent: 'Safari' };
    return { q, id: key.id, from, lastUsed: () => q.getApiKey(key.id)!.lastUsedAt };
  }

  it('writes the first use', async () => {
    const { q, id, from, lastUsed } = await setup();
    q.touchApiKey(id, from, T0);
    expect(lastUsed()).toBe(at(0));
    expect(q.getApiKey(id)).toMatchObject({ lastUsedIp: '10.0.0.2', lastUsedUserAgent: 'Safari' });
  });

  it('skips repeat uses from the same place within a minute, then writes again', async () => {
    const { q, id, from, lastUsed } = await setup();
    q.touchApiKey(id, from, T0);
    q.touchApiKey(id, from, T0 + 30_000);
    q.touchApiKey(id, from, T0 + 59_999);
    expect(lastUsed()).toBe(at(0));
    q.touchApiKey(id, from, T0 + 60_000);
    expect(lastUsed()).toBe(at(60_000));
  });

  it('writes at once when the key is used from somewhere new', async () => {
    const { q, id, from, lastUsed } = await setup();
    q.touchApiKey(id, from, T0);
    q.touchApiKey(id, { ...from, ip: '192.168.1.9' }, T0 + 5_000);
    expect(lastUsed()).toBe(at(5_000));
    expect(q.getApiKey(id)!.lastUsedIp).toBe('192.168.1.9');
    q.touchApiKey(id, { ...from, ip: '192.168.1.9', userAgent: 'Ri desktop' }, T0 + 6_000);
    expect(q.getApiKey(id)!.lastUsedUserAgent).toBe('Ri desktop');
  });

  it('runs one UPDATE for a burst of requests', async () => {
    const { q, id, from } = await setup();
    const { getRawDb } = await import('@/lib/db');
    const prepare = vi.spyOn(getRawDb(), 'prepare');
    for (let i = 0; i < 20; i++) q.touchApiKey(id, from, T0 + i * 1_000);
    expect(prepare.mock.calls.filter(([sql]) => /^update "api_keys"/.test(sql))).toHaveLength(1);
  });
});
