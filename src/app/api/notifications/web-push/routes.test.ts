import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const queries = vi.hoisted(() => ({ registerWebPushSubscription: vi.fn(), getWebPushSubscriptionByEndpoint: vi.fn(), deleteWebPushSubscriptionForUser: vi.fn(), listNotificationChannels: vi.fn() }));
vi.mock('@/lib/db/queries', () => queries);
vi.mock('@/lib/notifications/user', () => ({ getNotifierUserId: () => 'current-user' }));
import { POST as subscribe } from './subscribe/route';
import { POST as unsubscribe } from './unsubscribe/route';
import { POST as status } from './status/route';
import { defaultChannelEvents } from '@/lib/notifications/events';

const subscription = { endpoint: 'https://push.example/private-endpoint', keys: { p256dh: 'public-key', auth: 'secret-auth' } };
const request = (body: unknown) => new NextRequest('https://ri.example/api/notifications/web-push', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
beforeEach(() => {
  vi.resetAllMocks();
  queries.registerWebPushSubscription.mockReturnValue(true);
  queries.getWebPushSubscriptionByEndpoint.mockReturnValue({ ...subscription.keys });
  queries.listNotificationChannels.mockReturnValue([{ kind: 'web_push', enabled: false, events: ['execution.needs_input'], userId: 'current-user', config: { private: 'hidden' } }]);
});

describe('browser push routes', () => {
  it('registers with the authenticated user and default events through the atomic preference-preserving helper', async () => {
    const response = await subscribe(request(subscription));
    expect(response.status).toBe(200);
    expect(queries.registerWebPushSubscription).toHaveBeenCalledWith({ userId: 'current-user', endpoint: subscription.endpoint, ...subscription.keys }, defaultChannelEvents());
    expect(queries.listNotificationChannels).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('reports owner collisions and persistence failures without exposing private values', async () => {
    queries.registerWebPushSubscription.mockReturnValue(false);
    expect((await subscribe(request(subscription))).status).toBe(409);
    queries.registerWebPushSubscription.mockImplementation(() => { throw new Error(subscription.endpoint); });
    const response = await subscribe(request(subscription));
    expect(response.status).toBe(500); expect(await response.text()).not.toContain(subscription.endpoint);
  });
  it('returns only registration health and routing preferences, including paused channels', async () => {
    const response = await status(request(subscription));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ registered: true, channel: { enabled: false, events: ['execution.needs_input'] } });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(queries.getWebPushSubscriptionByEndpoint).toHaveBeenCalledWith('current-user', subscription.endpoint);
    expect(queries.registerWebPushSubscription).not.toHaveBeenCalled();
  });
  it.each(['missing', 'p256dh', 'auth'])('does not confirm a %s or mismatched server registration', async mismatch => {
    queries.getWebPushSubscriptionByEndpoint.mockReturnValue(mismatch === 'missing' ? undefined : { ...subscription.keys, [mismatch]: 'different' });
    expect((await (await status(request(subscription))).json()).registered).toBe(false);
  });
  it('reports deleted channels and empty local registration without automatically repairing either', async () => {
    queries.listNotificationChannels.mockReturnValue([]);
    expect(await (await status(request(subscription))).json()).toEqual({ registered: true, channel: null });
    expect(await (await status(request({}))).json()).toEqual({ registered: false, channel: null });
    expect(queries.getWebPushSubscriptionByEndpoint).toHaveBeenCalledTimes(1);
    expect(queries.registerWebPushSubscription).not.toHaveBeenCalled();
  });
  it('scopes idempotent removal to this user and never changes channels or another endpoint', async () => {
    queries.deleteWebPushSubscriptionForUser.mockReturnValue(false);
    const response = await unsubscribe(request({ endpoint: subscription.endpoint }));
    expect(response.status).toBe(200);
    expect(queries.deleteWebPushSubscriptionForUser).toHaveBeenCalledExactlyOnceWith('current-user', subscription.endpoint);
    expect(queries.registerWebPushSubscription).not.toHaveBeenCalled();
    expect(queries.listNotificationChannels).not.toHaveBeenCalled();
  });
  it('reports failed removal as retryable instead of acknowledging success', async () => {
    queries.deleteWebPushSubscriptionForUser.mockImplementation(() => { throw new Error('private DB error'); });
    const response = await unsubscribe(request({ endpoint: subscription.endpoint }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Could not turn off browser notifications. Please retry.' });
  });
  it.each([
    {}, { ...subscription, endpoint: 'not a URL' }, { ...subscription, endpoint: 'http://push.example/' },
    { ...subscription, endpoint: 'https://name:pass@push.example/' }, { ...subscription, endpoint: 'https://push.example/#secret' },
    { ...subscription, endpoint: 42 }, { ...subscription, keys: { p256dh: 'invalid+base64', auth: 'auth' } },
    { ...subscription, keys: { p256dh: 'key', auth: '' } }, { ...subscription, keys: { p256dh: 'key', auth: 'x'.repeat(257) } },
    { ...subscription, userId: 'other-user' },
  ])('rejects malformed subscription input without touching storage: %j', async body => {
    expect((await subscribe(request(body))).status).toBe(400);
    expect(queries.registerWebPushSubscription).not.toHaveBeenCalled();
  });
  it.each([subscribe, unsubscribe, status])('bounds bodies and handles invalid JSON without echoing input', async handler => {
    expect((await handler(request({ junk: 'x'.repeat(9000) }))).status).toBe(413);
    const malformed = new NextRequest('https://ri.example/api/notifications/web-push', { method: 'POST', body: '{secret' });
    const response = await handler(malformed); expect(response.status).toBe(400); expect(await response.text()).not.toContain('{secret');
  });
  it('requires keys for endpoint status and does not accept arbitrary deletion shapes', async () => {
    expect((await status(request({ endpoint: subscription.endpoint }))).status).toBe(400);
    expect((await unsubscribe(request({ endpoint: subscription.endpoint, userId: 'other-user' }))).status).toBe(400);
    expect(queries.deleteWebPushSubscriptionForUser).not.toHaveBeenCalled();
  });
});
