import { API_KEY_ID_HEADER, API_KEY_SCOPE_HEADER, CALLER_LOCATION_HEADER } from '@/lib/auth/request-key';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ hash: '' }));
vi.mock('@/lib/auth/host-key', () => ({ isHostKeyHash: (hash: string) => hash === host.hash }));
let root: string;
let q: typeof import('@/lib/db/queries');
let route: typeof import('@/app/api/devices/me/desktop-notifications/route');
let paired: ReturnType<typeof import('@/lib/db/queries').pairDevice>;
const req = (body?: object, input: { token?: string; keyId?: string; scope?: string; location?: string } = {}) => new NextRequest('https://home.example/api/devices/me/desktop-notifications', {
  method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${input.token ?? paired.token.plaintext}`, [API_KEY_ID_HEADER]: input.keyId ?? paired.key.id,
    [API_KEY_SCOPE_HEADER]: input.scope ?? 'viewer', [CALLER_LOCATION_HEADER]: input.location ?? 'elsewhere', 'content-type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
beforeEach(async () => {
  host.hash = '';
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-remote-notification-'));
  vi.stubEnv('RI_ROOT', root); vi.stubEnv('RI_DB_PATH', path.join(root, 'data.db')); vi.stubEnv('RI_CONFIG_DIR', path.join(root, '.config')); vi.stubEnv('RI_WORK_DIR', path.join(root, '.work')); vi.stubEnv('NOTIFIER_USER_ID', 'local');
  (await import('@/lib/db')).resetDb();
  q = await import('@/lib/db/queries'); route = await import('@/app/api/devices/me/desktop-notifications/route');
  paired = q.pairDevice({ name: 'MacBook', kind: 'computer' });
});
afterEach(async () => { (await import('@/lib/db')).resetDb(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
it('uses the existing claim and acknowledgement pipeline in a fixed per-device channel', async () => {
  expect((await route.POST(req({ action: 'test' }))).status).toBe(409);
  const enabled = await (await route.POST(req({ action: 'enable' }))).json();
  expect(enabled.channel.id).toBe(`desktop:device:${paired.device.id}`);
  expect((await route.POST(req({ action: 'test' }))).status).toBe(200);
  const { claim } = await (await route.POST(req({ action: 'claim' }))).json();
  expect(claim.notification.url).toBe('/?settings=notifications');
  expect(await (await route.POST(req({ action: 'claim' }))).json()).toEqual({ claim: null });
  expect(await (await route.POST(req({ action: 'ack', id: claim.id, receipt: claim.receipt, status: 'sent' }))).json()).toEqual({ acknowledged: true });
  expect((await (await route.GET(req())).json()).history).toMatchObject([{ id: claim.id, status: 'sent' }]);
  expect((await route.GET(req())).headers.get('cache-control')).toBe('no-store');
});
it('cannot select, claim, or acknowledge another computer’s channel', async () => {
  await route.POST(req({ action: 'enable' })); await route.POST(req({ action: 'test' }));
  const { claim } = await (await route.POST(req({ action: 'claim' }))).json();
  const other = q.pairDevice({ name: 'Other Mac', kind: 'computer' });
  const auth = { token: other.token.plaintext, keyId: other.key.id };
  expect((await route.POST(req({ action: 'enable', channelId: `desktop:device:${paired.device.id}` }, auth))).status).toBe(400);
  expect(await (await route.POST(req({ action: 'claim' }, auth))).json()).toEqual({ claim: null });
  expect(await (await route.POST(req({ action: 'ack', id: claim.id, receipt: claim.receipt, status: 'sent' }, auth))).json()).toEqual({ acknowledged: false });
  expect((await route.POST(req({ action: 'enable' }, { ...auth, keyId: paired.key.id }))).status).toBe(403);
});
it.each(['worker', 'session'])('rejects %s credentials and host authority before modifying notifications', async scope => {
  expect((await route.POST(req({ action: 'enable' }, { scope }))).status).toBe(403);
  expect((await route.POST(req({ action: 'enable' }, { location: 'home' }))).status).toBe(403);
  expect(q.getNotificationChannel(`desktop:device:${paired.device.id}`)).toBeUndefined();
});
it('rejects missing context, mismatched bearer keys, and a worker key even with forged viewer scope', async () => {
  expect((await route.GET(new NextRequest('https://home.example/api/devices/me/desktop-notifications'))).status).toBe(403);
  expect((await route.GET(req(undefined, { token: 'wrong' }))).status).toBe(403);
  const worker = q.createApiKey({ deviceId: paired.device.id, role: 'worker', name: 'worker' });
  expect((await route.GET(req(undefined, { keyId: worker.key.id, token: worker.token.plaintext }))).status).toBe(403);
});
it('revocation or expiry immediately denies polling and acknowledgements', async () => {
  await route.POST(req({ action: 'enable' }));
  q.revokeApiKey(paired.key.id);
  expect((await route.GET(req())).status).toBe(403);
  expect((await route.POST(req({ action: 'claim' }))).status).toBe(403);
  paired = q.pairDevice({ name: 'Expired Mac', kind: 'computer', expiresAt: '2000-01-01T00:00:00.000Z' });
  expect((await route.GET(req())).status).toBe(403);
});
it('rejects a retired device even when its sign-in key itself remains unrevoked', async () => {
  q.removeDevice(paired.device.id, 'Removed');
  const key = q.createApiKey({ name: 'stale sign in', deviceId: paired.device.id, role: 'sign_in' });
  expect((await route.GET(req(undefined, { token: key.token.plaintext, keyId: key.key.id }))).status).toBe(403);
});

it('rejects the Home host credential even with forged remote caller context', async () => {
  host.hash = paired.key.hash;
  expect((await route.GET(req())).status).toBe(403);
});

it('rejects phone sign-in credentials without creating a desktop channel', async () => {
  paired = q.pairDevice({ name: 'Phone', kind: 'phone' });
  expect((await route.GET(req())).status).toBe(403);
  expect((await route.POST(req({ action: 'enable' }))).status).toBe(403);
  expect(q.getNotificationChannel(`desktop:device:${paired.device.id}`)).toBeUndefined();
});
