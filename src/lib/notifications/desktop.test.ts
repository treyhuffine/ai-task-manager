import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { desktopNotificationPath } from './desktop-contract';
import type { NotificationEvent } from './types';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-desktop-notifications-test-'));
vi.mock('@/lib/auth/config-file', () => ({ readAuthConfig: () => ({ localToken: 'owner' }) }));
vi.mock('@/lib/service/paths', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/service/paths')>();
  return { ...actual, servicePaths: () => ({ ...actual.servicePaths(), id: 'test-installation' }) };
});
const id = 'desktop:test-installation';
const event = (dedupeKey = 'run-1'): NotificationEvent => ({ type: 'execution.finished', userId: 'local', dedupeKey,
  title: 'Finished', body: 'Ready to review', url: '/?session=chat-1' });
let queries: typeof import('@/lib/db/queries');
let notify: typeof import('./notify').notify;
let route: typeof import('@/app/api/desktop/notifications/route');
beforeEach(async () => {
  const { resetDb } = await import('@/lib/db'); resetDb();
  vi.stubEnv('RI_DB_PATH', path.join(base, 'data.db'));
  vi.stubEnv('RI_DESKTOP_CLIENT_SECRET', 'private-desktop-capability');
  vi.stubEnv('NOTIFIER_USER_ID', 'local');
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.join(base, `data.db${suffix}`), { force: true });
  queries = await import('@/lib/db/queries');
  ({ notify } = await import('./notify'));
  route = await import('@/app/api/desktop/notifications/route');
});
afterAll(async () => { (await import('@/lib/db')).resetDb(); vi.unstubAllEnvs(); fs.rmSync(base, { recursive: true, force: true }); });
const since = () => new Date(Date.now() - 86400000).toISOString();
const request = (body?: unknown, owner = 'owner', capability = 'private-desktop-capability') => new NextRequest('https://localhost/api/desktop/notifications', {
  method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${owner}`, 'x-ri-desktop-client': capability, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe('durable native delivery', () => {
  it('is opt-in, preserves event choices and queues without falsely marking OS delivery', async () => {
    await notify(event()); expect(queries.listNotificationDeliveries('local')).toEqual([]);
    queries.enableDesktopNotificationChannel(id, 'local', ['execution.finished']);
    await notify(event()); await notify(event());
    expect(queries.listNotificationDeliveries('local')).toMatchObject([{ status: 'pending', attempts: 0, sentAt: null }]);
    queries.updateNotificationChannel(id, { events: ['execution.needs_input'], enabled: false });
    expect(queries.enableDesktopNotificationChannel(id, 'local', ['execution.finished']).events).toEqual(['execution.needs_input']);
    await notify(event('run-2')); expect(queries.listNotificationDeliveries('local')).toHaveLength(1);
  });
  it('claims once, survives lost acknowledgments and rejects cross-owner/channel/receipt acknowledgments', async () => {
    queries.enableDesktopNotificationChannel(id, 'local', ['execution.finished']); await notify(event());
    const row = queries.claimDesktopNotificationDelivery(id, 'local', since())!;
    expect(row).toMatchObject({ status: 'skipped', attempts: 1, rendered: { title: 'Finished' } });
    expect(queries.claimDesktopNotificationDelivery(id, 'local', since())).toBeUndefined();
    await notify(event()); expect(queries.claimDesktopNotificationDelivery(id, 'local', since())).toBeUndefined();
    const ack = { channelId: id, userId: 'local', id: row.id, receipt: row.providerMessageId!, status: 'sent' as const };
    for (const patch of [{ userId: 'other' }, { channelId: 'other' }, { receipt: 'forged' }, { id: 'other' }]) expect(queries.acknowledgeDesktopNotificationDelivery({ ...ack, ...patch })).toBe(false);
    expect(queries.acknowledgeDesktopNotificationDelivery(ack)).toBe(true);
    expect(queries.acknowledgeDesktopNotificationDelivery({ ...ack, status: 'failed' })).toBe(false);
    expect(queries.getDelivery(event().dedupeKey, id)).toMatchObject({ status: 'sent', attempts: 1 });
  });
  it('finalizes unknown outcomes once and expires old pending alerts', async () => {
    queries.enableDesktopNotificationChannel(id, 'local', ['execution.finished']);
    queries.upsertDelivery({ channelId: id, userId: 'local', dedupeKey: 'old', eventType: event().type, event: event('old'), createdAt: '2020-01-01T00:00:00.000Z' });
    await notify(event());
    const row = queries.claimDesktopNotificationDelivery(id, 'local', since())!;
    expect(queries.getDelivery('old', id)).toMatchObject({ status: 'skipped', attempts: 0, providerMessageId: null });
    const ack = { channelId: id, userId: 'local', id: row.id, receipt: row.providerMessageId!, status: 'skipped' as const };
    expect(queries.acknowledgeDesktopNotificationDelivery(ack)).toBe(true);
    expect(queries.acknowledgeDesktopNotificationDelivery({ ...ack, status: 'sent' })).toBe(false);
  });
  it('does not claim disabled, foreign or non-desktop destinations', async () => {
    queries.enableDesktopNotificationChannel(id, 'local', ['execution.finished']); await notify(event());
    expect(queries.claimDesktopNotificationDelivery(id, 'other', since())).toBeUndefined();
    queries.updateNotificationChannel(id, { enabled: false });
    expect(queries.claimDesktopNotificationDelivery(id, 'local', since())).toBeUndefined();
    expect(() => queries.enableDesktopNotificationChannel(id, 'other', [])).toThrow('another channel');
  });
});

describe('owner desktop API', () => {
  it.each([['', ''], ['owner', ''], ['phone', 'private-desktop-capability'], ['owner', 'wrong']])('denies owner=%s capability=%s before modifying state', async (owner, capability) => {
    expect(route.GET(request(undefined, owner, capability)).status).toBe(403);
    expect((await route.POST(request({ action: 'enable' }, owner, capability))).status).toBe(403);
    expect(queries.getNotificationChannel(id)).toBeUndefined();
  });
  it('supports preference, explicit test, bounded claim and acknowledgment end to end', async () => {
    expect((await route.POST(request({ action: 'test' }))).status).toBe(409);
    expect((await route.POST(request({ action: 'enable' }))).status).toBe(200);
    expect((await route.POST(request({ action: 'test' }))).status).toBe(200);
    const response = await route.POST(request({ action: 'claim' }));
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { claim } = await response.json();
    expect(claim.notification.url).toBe('/?settings=notifications');
    expect(await (await route.POST(request({ action: 'ack', id: claim.id, receipt: claim.receipt, status: 'sent' }))).json()).toEqual({ acknowledged: true });
    expect((await route.GET(request()).json()).history).toMatchObject([{ id: claim.id, status: 'sent' }]);
    expect((await route.POST(request({ action: 'disable' }))).status).toBe(200);
    expect(queries.getNotificationChannel(id)?.enabled).toBe(false);
  });
  it.each([{ action: 'arbitrary' }, { action: 'test', title: 'untrusted' }, { action: 'ack', id: 'x', receipt: 'x', status: 'pending' }, { action: 'enable', extra: 'x'.repeat(5000) }])('rejects invalid IPC backend action %#', async body => {
    expect((await route.POST(request(body))).status).toBe(400);
    expect(queries.getNotificationChannel(id)).toBeUndefined();
  });
});

it.each(['https://evil.example', '//evil.example', '/\\evil', '/api/attachments/a', '/%61pi/service/update', '/%2561pi/x', '/_next/static/x', '/%5cevil', '/bad%xy', '/x\n'])('sanitizes unsafe notification destinations %s', raw => {
  expect(desktopNotificationPath(raw)).toBe('/');
});
it('keeps app navigation and strips fragments', () => {
  expect(desktopNotificationPath('/?session=chat-1#secret')).toBe('/?session=chat-1');
  expect(desktopNotificationPath('/notes/a?view=full')).toBe('/notes/a?view=full');
});
