import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationChannelRecord } from '@/db/types';

const sendNotification = vi.hoisted(() => vi.fn());
vi.mock('web-push', () => ({ default: { sendNotification } }));
vi.mock('../web-push/vapid', () => ({ configureWebPush: () => {} }));
vi.mock('@/lib/db/queries', () => ({
  listWebPushSubscriptions: () => [{ endpoint: 'https://push.example/1', p256dh: 'key', auth: 'auth' }],
  deleteWebPushSubscriptionByEndpoint: () => {},
}));

const { WEB_PUSH_PAYLOAD_MAX, webPushAdapter, webPushPayload } = await import('./web-push');
const { LINE_BODY_MAX } = await import('../message-text');

const url = '/?session=01a0';
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

beforeEach(() => {
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({});
});

describe('webPushPayload', () => {
  it('carries a notification line whole', () => {
    const body = 'All green. '.repeat(90).trim();
    expect(JSON.parse(webPushPayload({ title: '✅ Fix auth', body, url }))).toEqual({ title: '✅ Fix auth', body, url });
  });

  it('holds a full line in the widest characters inside the limit', () => {
    const body = '日'.repeat(LINE_BODY_MAX);
    const payload = webPushPayload({ title: '✅ 修正', body, url });
    expect(bytes(payload)).toBeLessThanOrEqual(WEB_PUSH_PAYLOAD_MAX);
    expect(JSON.parse(payload).body).toBe(body);
  });

  it('fits a body that would push the payload past what a push service accepts', () => {
    const payload = webPushPayload({ title: 'A long title '.repeat(40), body: '"quoted" 日本 '.repeat(400), url });
    expect(bytes(payload)).toBeLessThanOrEqual(WEB_PUSH_PAYLOAD_MAX);
    expect(JSON.parse(payload).body).toMatch(/…$/);
  });
});

describe('webPushAdapter.deliver', () => {
  it('sends the fitted payload to every subscription', async () => {
    const channel = { id: 'c1', kind: 'web_push', userId: 'local' } as unknown as NotificationChannelRecord;
    await webPushAdapter.deliver(channel, { title: 'T', body: 'x '.repeat(5000), url });
    const [subscription, payload] = sendNotification.mock.calls[0]!;
    expect(subscription).toEqual({ endpoint: 'https://push.example/1', keys: { p256dh: 'key', auth: 'auth' } });
    expect(bytes(payload)).toBeLessThanOrEqual(WEB_PUSH_PAYLOAD_MAX);
  });
});
