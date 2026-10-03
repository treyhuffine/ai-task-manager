import type { NotificationHistoryResponse } from '@/lib/notifications/history';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-notification-history-test-'));
let queries: typeof import('@/lib/db/queries');
let route: typeof import('./route');
beforeEach(async () => {
  (await import('@/lib/db')).resetDb();
  vi.stubEnv('RI_ROOT', path.join(base, 'home'));
  vi.stubEnv('RI_DB_PATH', path.join(base, 'history.db'));
  vi.stubEnv('NOTIFIER_USER_ID', 'history-owner');
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.join(base, `history.db${suffix}`), { force: true });
  queries = await import('@/lib/db/queries'); route = await import('./route');
});
afterAll(async () => { (await import('@/lib/db')).resetDb(); vi.unstubAllEnvs(); fs.rmSync(base, { recursive: true, force: true }); });
afterEach(() => vi.restoreAllMocks());
function insert(channelId: string, id: string, userId = 'history-owner', createdAt = '2026-09-26T00:00:00.000Z') {
  queries.upsertDelivery({ id, channelId, userId, dedupeKey: id, eventType: 'execution.finished', createdAt,
    event: { type: 'execution.finished', userId, dedupeKey: id, title: id, body: 'private-body-secret', url: '/?token=url-secret' } });
}

it('returns only the current user’s latest 100 deliveries in stable order, with a private response', async () => {
  queries.createNotificationChannel({ id: 'own', userId: 'history-owner', kind: 'web_push', label: 'My browsers', config: { endpoint: 'endpoint-secret' } });
  queries.createNotificationChannel({ id: 'other', userId: 'other-owner', kind: 'connector', providerId: 'telegram', label: 'other-owner-secret' });
  for (let i = 0; i < 105; i++) insert('own', `delivery-${String(i).padStart(3, '0')}`);
  insert('other', 'other-delivery-secret', 'other-owner', '2026-09-27T00:00:00.000Z');
  queries.markDeliveryFailed('delivery-104', '403 endpoint-secret token-secret Authorization: Bearer provider-secret');
  const response = await Reflect.apply(route.GET, undefined, [new Request('https://localhost/api/notifications/deliveries?userId=other-owner&limit=999999')]);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const body: NotificationHistoryResponse = await response.json();
  expect(body.limit).toBe(100); expect(body.deliveries).toHaveLength(100);
  expect(body.deliveries[0]).toMatchObject({ id: 'delivery-104', status: 'failed', attempts: 1, channel: { label: 'My browsers' } });
  expect(body.deliveries.at(-1)?.id).toBe('delivery-005');
  expect(JSON.stringify(body)).not.toMatch(/endpoint-secret|token-secret|provider-secret|other-owner-secret|other-delivery-secret|private-body-secret|url-secret/);
});

it('reads desktop queued, uncertain, expired and acknowledged states without consuming or retrying them', async () => {
  const channel = queries.enableDesktopNotificationChannel('desktop:history', 'history-owner', ['execution.finished']);
  insert(channel.id, 'expired', 'history-owner', '2020-01-01T00:00:00.000Z');
  insert(channel.id, 'claim', 'history-owner', new Date().toISOString());
  const before: NotificationHistoryResponse = await (await route.GET(new Request('http://localhost/api/test'))).json();
  expect(before.deliveries.every(item => item.status === 'queued')).toBe(true);
  const claimed = queries.claimDesktopNotificationDelivery(channel.id, 'history-owner', new Date(Date.now() - 86400000).toISOString())!;
  expect(claimed.id).toBe('claim');
  const history: NotificationHistoryResponse = await (await route.GET(new Request('http://localhost/api/test'))).json();
  expect(history.deliveries.find(item => item.id === 'claim')?.status).toBe('uncertain');
  expect(history.deliveries.find(item => item.id === 'expired')?.status).toBe('expired');
  expect(queries.getDelivery('claim', channel.id)?.attempts).toBe(1);
  queries.acknowledgeDesktopNotificationDelivery({ id: claimed.id, channelId: channel.id, userId: 'history-owner', receipt: claimed.providerMessageId!, status: 'sent' });
  const final: NotificationHistoryResponse = await (await route.GET(new Request('http://localhost/api/test'))).json();
  expect(final.deliveries.find(item => item.id === 'claim')).toMatchObject({ status: 'sent', attempts: 1 });
});

it('retains the existing channel-deletion cascade instead of creating a permanent inbox', async () => {
  const channel = queries.createNotificationChannel({ id: 'removed', userId: 'history-owner', kind: 'web_push' });
  insert(channel.id, 'delivery'); expect((await (await route.GET(new Request('http://localhost/api/test'))).json()).deliveries).toHaveLength(1);
  queries.deleteNotificationChannel(channel.id); expect((await (await route.GET(new Request('http://localhost/api/test'))).json()).deliveries).toEqual([]);
});

it('returns a private generic failure without disclosing internal database or credential errors', async () => {
  vi.spyOn(queries, 'listNotificationDeliveries').mockImplementationOnce(() => { throw new Error('SQLite /private/account api_key=private-secret'); });
  const response = (await route.GET(new Request('http://localhost/api/test')));
  expect(response.status).toBe(500); expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({ error: 'Notification history is unavailable. Try refreshing shortly.' });
});
