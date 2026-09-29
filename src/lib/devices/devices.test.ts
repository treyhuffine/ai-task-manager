/**
 * Devices (docs/homes-build.md, "Devices"): everything that reaches a home
 * is a device, and every key belongs to one. A device runs agents when it's
 * the home, or while its worker key is active.
 */

import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { API_KEY_ID_HEADER, CALLER_LOCATION_HEADER } from '@/lib/auth/request-key';

let home: TestHome;

beforeEach(async () => {
  process.env.RI_MIRROR_DISABLED = '1';
  home = await createTestHome({ prefix: 'ri-devices-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
});

afterEach(async () => {
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
  delete process.env.RI_MIRROR_DISABLED;
});

function request(url: string, init: { method?: string; body?: unknown; keyId?: string; userAgent?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.keyId) {
    headers[API_KEY_ID_HEADER] = init.keyId;
    headers[CALLER_LOCATION_HEADER] = 'elsewhere';
  }
  if (init.userAgent) headers['user-agent'] = init.userAgent;
  return new NextRequest(`http://127.0.0.1${url}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

/** The home, its own key, and a MacBook enrolled to run agents. */
async function homeWithWorker() {
  const q = await import('@/lib/db/queries');
  const { ensureHomeIdentity } = await import('@/lib/home/identity');
  const { ensureLocalToken } = await import('@/lib/auth/bootstrap');
  const host = ensureHomeIdentity().device;
  ensureLocalToken();
  const macbook = q.pairDevice({ name: 'MacBook', kind: 'computer' });
  const grant = q.createDeviceGrant({ kind: 'enroll', deviceId: macbook.device.id, createdByApiKeyId: macbook.key.id });
  const enrolled = q.redeemEnrollGrant({ secret: grant.secret, name: 'AI-MacBook' });
  return { q, host, macbook, workerKeyId: enrolled.key.id };
}

describe('the homes migration', () => {
  it("gives each key paired before devices a device of its own, and leaves the home's own for its identity", async () => {
    const Database = (await import('better-sqlite3')).default;
    const { createDatabaseAt, migrationTags } = await import('@/test/fixtures/migrations');
    const { runMigrations } = await import('@/lib/db/migrate');
    const file = path.join(home.root, 'pre-homes.db');
    createDatabaseAt(file, migrationTags()[1]!);
    const sqlite = new Database(file);
    try {
      const insert = sqlite.prepare(
        `INSERT INTO api_keys (id, name, device_type, prefix, suffix, hash, env, revoked_at) VALUES (?, ?, ?, 'ri_live_', 'abcd', ?, 'live', ?)`,
      );
      insert.run('k-phone', 'iPhone', 'phone', 'h1', null);
      insert.run('k-host', 'ai-mac-mini (host)', 'host', 'h2', null);
      insert.run('k-old', 'Old laptop', 'computer', 'h3', '2026-08-01T00:00:00.000Z');
      runMigrations(sqlite, path.resolve('drizzle'));
      const devices = sqlite.prepare('SELECT id, name, kind, status, revoked_at FROM devices ORDER BY id').all();
      expect(devices).toEqual([
        { id: 'k-old', name: 'Old laptop', kind: 'computer', status: 'revoked', revoked_at: '2026-08-01T00:00:00.000Z' },
        { id: 'k-phone', name: 'iPhone', kind: 'phone', status: 'active', revoked_at: null },
      ]);
      expect(sqlite.prepare('SELECT id, device_id FROM api_keys ORDER BY id').all()).toEqual([
        { id: 'k-host', device_id: null },
        { id: 'k-old', device_id: 'k-old' },
        { id: 'k-phone', device_id: 'k-phone' },
      ]);
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it("gives the home's own keys the home's device at its first start", async () => {
    const q = await import('@/lib/db/queries');
    const { ensureLocalToken } = await import('@/lib/auth/bootstrap');
    const { ensureHomeIdentity } = await import('@/lib/home/identity');
    // First start: the key comes before the home's identity.
    const { findApiKeyByHash } = q;
    const { hashToken } = await import('@/lib/auth/tokens');
    const token = ensureLocalToken().plaintext;
    expect(findApiKeyByHash(hashToken(token))!.deviceId).toBeNull();
    const host = ensureHomeIdentity().device;
    expect(findApiKeyByHash(hashToken(token))!.deviceId).toBe(host.id);
    expect(host.kind).toBe('computer');
  });
});

describe('running agents', () => {
  it("is the home, or a device while its worker key is active", async () => {
    const { q, host, macbook, workerKeyId } = await homeWithWorker();
    expect(q.getDevice(macbook.device.id)?.workerKeyId).toBe(workerKeyId);
    expect(q.getWorkerDevice(workerKeyId)?.id).toBe(macbook.device.id);
    expect(q.getWorkerKeyId(macbook.device.id)).toBe(workerKeyId);
    expect(q.listEnrolledDeviceIds()).toEqual(new Set([macbook.device.id]));
    // The worker key belongs to the MacBook, beside the key it paired with.
    expect(q.getApiKey(workerKeyId)?.deviceId).toBe(macbook.device.id);
    expect(q.isWorkerApiKey(macbook.key.id)).toBe(false);

    // Revoking the worker key turns it off: the flag is cleared.
    q.revokeApiKey(workerKeyId, 'off');
    expect(q.getDevice(macbook.device.id)?.workerKeyId).toBeNull();
    expect(q.getWorkerDevice(workerKeyId)).toBeNull();
    expect(q.listEnrolledDeviceIds().size).toBe(0);
    expect(q.getWorkerKeyId(host.id)).toBeNull();
  });

  it('enrolling again replaces the worker key, one worker per device', async () => {
    const { q, macbook, workerKeyId } = await homeWithWorker();
    const grant = q.createDeviceGrant({ kind: 'enroll', deviceId: macbook.device.id, createdByApiKeyId: null });
    const again = q.redeemEnrollGrant({ secret: grant.secret, name: 'MacBook' });
    expect(again.device.workerKeyId).toBe(again.key.id);
    expect(q.getApiKey(workerKeyId)?.revokedAt).not.toBeNull();
    expect(q.isWorkerApiKey(workerKeyId)).toBe(false);
  });

  it("never enrolls the home's own device", async () => {
    const { q, host } = await homeWithWorker();
    expect(() => q.createDeviceGrant({ kind: 'enroll', deviceId: host.id, createdByApiKeyId: null })).toThrow(/where this home runs/);
  });
});

describe('the device list', () => {
  it('shows each device once, with its keys, what each is for, and which one is asking', async () => {
    const { q, host, macbook, workerKeyId } = await homeWithWorker();
    const phone = q.pairDevice({ name: 'iPhone', kind: 'phone' });
    const { listDeviceViews } = await import('./views');
    const views = await listDeviceViews({ callerKeyId: phone.key.id });
    expect(views.map((d) => [d.name, d.isHome, d.runsAgents, d.isThisDevice])).toEqual([
      [host.name, true, true, false],
      ['MacBook', false, true, false],
      ['iPhone', false, false, true],
    ]);
    const roles = (id: string) => views.find((d) => d.id === id)!.keys.map((k) => [k.id, k.role]).sort();
    const hostKey = views.find((d) => d.isHome)!.keys;
    expect(hostKey.map((k) => k.role)).toEqual(['home']);
    expect(roles(macbook.device.id)).toEqual([[macbook.key.id, 'sign-in'], [workerKeyId, 'worker']].sort());
    expect(views.find((d) => d.id === phone.device.id)!.keys[0]).toMatchObject({ role: 'sign-in', current: true });
    // No secret leaves the home.
    expect(JSON.stringify(views)).not.toContain(q.getApiKey(phone.key.id)!.hash);
  });
});

describe('the devices API', () => {
  it('pairs a device with its first key, guessing its type from the browser when unsaid', async () => {
    const { POST } = await import('@/app/api/devices/route');
    const res = await POST(request('/api/devices', { method: 'POST', body: { name: 'iPad' }, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { device: { name: string; kind: string; keys: unknown[] }; key: { role: string }; plaintext: string };
    expect(body.device).toMatchObject({ name: 'iPad', kind: 'tablet' });
    expect(body.device.keys).toHaveLength(1);
    expect(body.key.role).toBe('sign-in');
    expect(body.plaintext).toMatch(/^ri_/);
  });

  it('renames a device and says what it is, never the home', async () => {
    const { q } = await homeWithWorker();
    const phone = q.pairDevice({ name: 'Phone', kind: 'other' });
    const { PATCH } = await import('@/app/api/devices/[id]/route');
    const res = await PATCH(request(`/api/devices/${phone.device.id}`, { method: 'PATCH', body: { name: 'iPhone', kind: 'phone' } }), params({ id: phone.device.id }));
    expect(await res.json()).toMatchObject({ name: 'iPhone', kind: 'phone' });
    const bad = await PATCH(request(`/api/devices/${phone.device.id}`, { method: 'PATCH', body: { kind: 'host' } }), params({ id: phone.device.id }));
    expect(bad.status).toBe(400);
  });

  it('removes a device: its keys stop, its worker with them, and the home stays', async () => {
    const { q, host, macbook, workerKeyId } = await homeWithWorker();
    const { DELETE } = await import('@/app/api/devices/[id]/route');
    const refused = await DELETE(request(`/api/devices/${host.id}`, { method: 'DELETE' }), params({ id: host.id }));
    expect(refused.status).toBe(409);
    const res = await DELETE(request(`/api/devices/${macbook.device.id}`, { method: 'DELETE' }), params({ id: macbook.device.id }));
    expect(res.status).toBe(204);
    expect(q.getDevice(macbook.device.id)).toMatchObject({ status: 'revoked', workerKeyId: null });
    expect(q.getApiKey(macbook.key.id)?.revokedAt).not.toBeNull();
    expect(q.getApiKey(workerKeyId)?.revokedAt).not.toBeNull();
    expect(q.listDevices().map((d) => d.id)).toEqual([host.id]);
  });

  it("gives a device another pairing link, and revokes one key at a time, but not the home's own", async () => {
    const { q, host, macbook, workerKeyId } = await homeWithWorker();
    const keys = await import('@/app/api/devices/[id]/keys/route');
    const one = await import('@/app/api/devices/[id]/keys/[keyId]/route');
    const added = await keys.POST(request(`/api/devices/${macbook.device.id}/keys`, { method: 'POST', body: {} }), params({ id: macbook.device.id }));
    expect(added.status).toBe(201);
    const { key } = (await added.json()) as { key: { id: string } };
    expect(q.getApiKey(key.id)?.deviceId).toBe(macbook.device.id);

    // A key on another device is not found there.
    const wrong = await one.DELETE(request('/x', { method: 'DELETE' }), params({ id: host.id, keyId: key.id }));
    expect(wrong.status).toBe(404);
    expect((await one.DELETE(request('/x', { method: 'DELETE' }), params({ id: macbook.device.id, keyId: key.id }))).status).toBe(204);
    expect(q.getApiKey(key.id)?.revokedAt).not.toBeNull();

    // The worker key: the MacBook stops running agents, and stays.
    expect((await one.DELETE(request('/x', { method: 'DELETE' }), params({ id: macbook.device.id, keyId: workerKeyId }))).status).toBe(204);
    expect(q.getDevice(macbook.device.id)).toMatchObject({ status: 'active', workerKeyId: null });

    const homeKey = q.listApiKeys().find((k) => k.deviceId === host.id)!;
    const refused = await one.DELETE(request('/x', { method: 'DELETE' }), params({ id: host.id, keyId: homeKey.id }));
    expect(refused.status).toBe(409);
    expect(q.getApiKey(homeKey.id)?.revokedAt).toBeNull();
  });
});

describe('one computer, one device', () => {
  it("joins a computer's own key to the device it enrolled as, and removes the one its pairing made", async () => {
    const { q, macbook } = await homeWithWorker();
    // The laptop connected with a link made for "Laptop", then enrolled as the MacBook the home knew.
    const laptop = q.pairDevice({ name: 'Laptop', kind: 'computer' });
    const joined = q.registerDeviceForApiKey({ apiKeyId: laptop.key.id, name: 'AI-MacBook', deviceId: macbook.device.id });
    expect(joined).toMatchObject({ device: { id: macbook.device.id, name: 'MacBook' }, created: false });
    expect(q.getDevice(laptop.device.id)?.status).toBe('revoked');
  });

  it("keeps a device that still has keys when one of them moves", async () => {
    const { q, macbook } = await homeWithWorker();
    const shared = q.pairDevice({ name: 'Shared', kind: 'computer' });
    const second = q.addDeviceKey(shared.device.id);
    q.registerDeviceForApiKey({ apiKeyId: second.key.id, name: 'x', deviceId: macbook.device.id });
    expect(q.getDevice(shared.device.id)?.status).toBe('active');
  });

  it("never moves a key onto the home's device, or the home's key off it", async () => {
    const { q, host } = await homeWithWorker();
    const other = q.pairDevice({ name: 'Other', kind: 'computer' });
    const result = q.registerDeviceForApiKey({ apiKeyId: other.key.id, name: 'Other', deviceId: host.id });
    expect(result.device.id).toBe(other.device.id);
    const homeKey = q.listApiKeys().find((k) => k.deviceId === host.id)!;
    expect(q.registerDeviceForApiKey({ apiKeyId: homeKey.id, name: 'x', deviceId: other.device.id }).device.id).toBe(host.id);
  });
});
