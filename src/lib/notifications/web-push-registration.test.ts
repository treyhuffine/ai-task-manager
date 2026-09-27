import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-push-registration-test-'));
let queries: typeof import('@/lib/db/queries');
let database: typeof import('@/lib/db');
const input = { userId: 'local', endpoint: 'https://push.example/one', p256dh: 'public-key', auth: 'auth-key' };

beforeEach(async () => {
  database = await import('@/lib/db');
  database.resetDb();
  vi.stubEnv('RI_DB_PATH', path.join(base, 'data.db'));
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.join(base, `data.db${suffix}`), { force: true });
  queries = await import('@/lib/db/queries');
});
afterAll(() => { database.resetDb(); vi.unstubAllEnvs(); fs.rmSync(base, { recursive: true, force: true }); });

describe('browser registration persistence', () => {
  it('creates one channel and preserves its identity, disabled choice, label and routing during repair', () => {
    expect(queries.registerWebPushSubscription(input, ['execution.finished'])).toBe(true);
    const channel = queries.listNotificationChannels({ userId: 'local' })[0];
    queries.updateNotificationChannel(channel.id, { enabled: false, events: ['execution.needs_input'], label: 'My browsers' });
    expect(queries.registerWebPushSubscription({ ...input, auth: 'repaired-key' }, ['execution.finished'])).toBe(true);
    expect(queries.listNotificationChannels({ userId: 'local' })).toMatchObject([
      { id: channel.id, enabled: false, events: ['execution.needs_input'], label: 'My browsers' },
    ]);
    expect(queries.listWebPushSubscriptions('local')).toMatchObject([{ endpoint: input.endpoint, auth: 'repaired-key' }]);
  });

  it('refuses to adopt another subject’s endpoint or create a channel for the rejected registration', () => {
    queries.registerWebPushSubscription(input, []);
    expect(queries.registerWebPushSubscription({ ...input, userId: 'other', auth: 'stolen-key' }, [])).toBe(false);
    expect(queries.getWebPushSubscriptionByEndpoint('other', input.endpoint)).toBeUndefined();
    expect(queries.getWebPushSubscriptionByEndpoint('local', input.endpoint)?.auth).toBe('auth-key');
    expect(queries.listNotificationChannels({ userId: 'other' })).toEqual([]);
  });

  it('removes only the selected subject’s browser and leaves channel preferences intact', () => {
    queries.registerWebPushSubscription(input, ['execution.finished']);
    queries.registerWebPushSubscription({ ...input, endpoint: 'https://push.example/two' }, []);
    const channel = queries.listNotificationChannels({ userId: 'local' })[0];
    expect(queries.deleteWebPushSubscriptionForUser('other', input.endpoint)).toBe(false);
    expect(queries.deleteWebPushSubscriptionForUser('local', input.endpoint)).toBe(true);
    expect(queries.deleteWebPushSubscriptionForUser('local', input.endpoint)).toBe(false);
    expect(queries.listWebPushSubscriptions('local').map(row => row.endpoint)).toEqual(['https://push.example/two']);
    expect(queries.getNotificationChannel(channel.id)).toEqual(channel);
  });

  it('rolls back the subscription when channel creation fails, leaving no half-registered device', () => {
    const sqlite = database.getRawDb();
    sqlite.exec("CREATE TEMP TRIGGER reject_test_channel BEFORE INSERT ON notification_channels BEGIN SELECT RAISE(ABORT, 'fixture channel failure'); END");
    try {
      expect(() => queries.registerWebPushSubscription(input, [])).toThrow('fixture channel failure');
      expect(queries.listWebPushSubscriptions('local')).toEqual([]);
      expect(queries.listNotificationChannels({ userId: 'local' })).toEqual([]);
    } finally { sqlite.exec('DROP TRIGGER reject_test_channel'); }
    expect(queries.registerWebPushSubscription(input, [])).toBe(true);
  });
});
