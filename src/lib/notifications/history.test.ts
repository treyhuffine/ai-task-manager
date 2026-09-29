import { describe, expect, it } from 'vitest';
import type { NotificationChannelRecord, NotificationDeliveryRecord } from '@/db/types';
import { notificationHistoryItem } from './history';

const channel = (patch: Partial<NotificationChannelRecord> = {}): NotificationChannelRecord => ({
  id: 'channel', userId: 'owner', createdAt: '2026-09-26T01:00:00Z', updatedAt: '2026-09-26T01:00:00Z', kind: 'in_app',
  label: null, providerId: null, connectionId: null, config: { surface: 'desktop' }, events: [], enabled: true, ...patch,
});
const row = (patch: Partial<NotificationDeliveryRecord> = {}): NotificationDeliveryRecord => ({
  id: 'delivery', userId: 'owner', channelId: 'channel', createdAt: '2026-09-26T01:00:00Z', updatedAt: '2026-09-26T01:00:00Z',
  eventType: 'execution.finished', dedupeKey: 'run-1', status: 'pending', attempts: 0, rendered: null, providerMessageId: null,
  lastError: null, nextAttemptAt: null, sentAt: null,
  event: { type: 'execution.finished', userId: 'owner', dedupeKey: 'run-1', title: 'Ready to review', body: 'private body', url: '/private?token=hidden' }, ...patch,
});

describe('notification history states', () => {
  it('distinguishes queued, uncertain, expired and unclassified skipped rows without inferring sent', () => {
    expect(notificationHistoryItem(row(), channel()).status).toBe('queued');
    for (const receipt of ['desktop:receipt-secret', 'ack:desktop:receipt-secret']) {
      const item = notificationHistoryItem(row({ status: 'skipped', attempts: 1, providerMessageId: receipt }), channel());
      expect(item.status).toBe('uncertain'); expect(item.detail).toContain('not be repeated');
    }
    const expired = row({ status: 'skipped', lastError: 'This desktop alert expired while the app was closed.' });
    expect(notificationHistoryItem(expired, channel()).status).toBe('expired');
    expect(notificationHistoryItem({ ...expired, attempts: 1 }, channel()).status).toBe('skipped');
    expect(notificationHistoryItem(expired, channel({ kind: 'web_push', config: {} })).status).toBe('skipped');
    expect(notificationHistoryItem(row({ status: 'skipped' }), channel()).status).toBe('skipped');
  });
  it('reports channel-specific acceptance without implying all devices received or read the alert', () => {
    const sent = row({ status: 'sent', attempts: 1, sentAt: '2026-09-26T01:01:00Z', lastError: 'old failed attempt' });
    expect(notificationHistoryItem(sent, channel()).detail).toContain('operating system reported showing');
    const push = notificationHistoryItem(sent, channel({ kind: 'web_push', config: {} }));
    expect(push.detail).toContain('At least one browser push service'); expect(push.detail).toContain('does not confirm every device');
    expect(notificationHistoryItem(sent, channel({ kind: 'connector', providerId: 'telegram', config: {} })).detail).toContain('Telegram accepted');
    expect(push.detail).not.toContain('old failed');
  });
  it.each([
    ['no web push subscriptions for this user', 'No reachable browser subscriptions'],
    ['web push reached 0/3 subscriptions (all expired/pruned)', 'No reachable browser subscriptions'],
    ['telegram channel is missing config.chatId', 'configuration is incomplete'],
    ['telegram delivery failed (auth_config_required)', 'configuration is incomplete'],
    ['telegram delivery failed (needs_account)', 'configuration is incomplete'],
    ['telegram delivery failed (auth_required)', 'permission or authorization'],
    ['telegram delivery failed (needs_consent)', 'permission or authorization'],
    ['403 https://private.push/token-secret Authorization: Bearer secret', 'permission or authorization'],
    ['fetch failed for https://private.push/token-secret', 'provider was unavailable'],
    ['429: secret-provider-receipt', 'limited notification requests'],
    ['unexpected failure with api_key=secret', 'Delivery failed'],
  ])('maps a useful fixed failure category for %s', (error, detail) => {
    const item = notificationHistoryItem(row({ status: 'failed', attempts: 2, lastError: error }), channel({ kind: 'web_push', config: {} }));
    expect(item.detail).toContain(detail); expect(item.attempts).toBe(2);
    expect(JSON.stringify(item)).not.toMatch(/token-secret|api_key|Bearer|secret-provider-receipt/);
  });
  it('keeps OS failures useful without copying arbitrary native failure details', () => {
    const item = notificationHistoryItem(row({ status: 'failed', lastError: 'OS failed: token-secret /private/account' }), channel());
    expect(item.detail).toContain('notification permissions'); expect(item.detail).not.toContain('token-secret');
  });
});

describe('notification history projection', () => {
  it('omits private bodies, URLs, routing data, provider receipts and raw errors', () => {
    const item = notificationHistoryItem(row({ providerMessageId: 'provider-secret', lastError: 'Bearer secret',
      rendered: { title: 'Rendered title', body: 'rendered-private-body', url: 'https://private.invalid?auth=secret' } }),
    channel({ label: 'My phone', connectionId: 'connection-secret', config: { endpoint: 'https://private.push', key: 'secret' } }));
    expect(item.title).toBe('Rendered title'); expect(item.channel.label).toBe('My phone');
    expect(Object.keys(item).sort()).toEqual(['attempts', 'channel', 'createdAt', 'detail', 'eventLabel', 'id', 'sentAt', 'status', 'title', 'updatedAt']);
    expect(JSON.stringify(item)).not.toMatch(/secret|private|dedupeKey|nextAttemptAt|providerMessageId/);
  });
  it('uses safe fallbacks for mismatched channel ownership and unfamiliar events', () => {
    const item = notificationHistoryItem(row({ eventType: 'https://unknown.private/token' }), channel({ userId: 'other', label: 'Other user secret' }));
    expect(item.channel).toEqual({ id: 'channel', label: 'Unavailable channel', type: 'unknown' });
    expect(item.eventLabel).toBe('Other event'); expect(JSON.stringify(item)).not.toContain('Other user');
  });
  it('bounds title/label text and strips control characters without producing links or markup', () => {
    const item = notificationHistoryItem(row({ rendered: { title: `\u202e${'t'.repeat(200)}`, body: '', url: '' } }), channel({ label: `\u0000${'l'.repeat(130)}` }));
    expect(item.title).toBe('t'.repeat(160)); expect(item.channel.label).toBe('l'.repeat(100));
  });
});
