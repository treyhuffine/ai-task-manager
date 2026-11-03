import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { backfillAgentMessageEvent } from './backfill';
import { defaultChannelEvents } from './events';

let home: TestHome;
beforeEach(async () => { home = await createTestHome(); });
afterEach(async () => { await home.cleanup(); });

const OLD_EVENTS = ['execution.needs_input', 'execution.finished'] as const;
const OLD = '2026-07-09T17:09:29.006Z';
const channel = (events: string[], updatedAt = OLD) => q.createNotificationChannel({ kind: 'web_push', events: events as never, config: {}, enabled: true, createdAt: OLD, updatedAt });

it('gives channels made before the event existed the new event, keeping what they had', () => {
  const a = channel([...OLD_EVENTS]);
  const b = channel([]);
  backfillAgentMessageEvent();
  expect(q.getNotificationChannel(a.id)?.events).toEqual([...OLD_EVENTS, 'agent.message']);
  expect(q.getNotificationChannel(b.id)?.events).toEqual(['agent.message']);
});

it('runs once: a channel turned off afterwards stays off, even the only one', () => {
  const a = channel([...OLD_EVENTS]);
  backfillAgentMessageEvent();
  q.updateNotificationChannel(a.id, { events: [...OLD_EVENTS] });
  backfillAgentMessageEvent();
  expect(q.getNotificationChannel(a.id)?.events).toEqual([...OLD_EVENTS]);
});

it('leaves a channel changed since the event was added', () => {
  const recent = channel([...OLD_EVENTS], '2026-12-01T00:00:00.000Z');
  backfillAgentMessageEvent();
  expect(q.getNotificationChannel(recent.id)?.events).toEqual([...OLD_EVENTS]);
});

it('new channels get the event by default', () => {
  expect(defaultChannelEvents()).toContain('agent.message');
});

it('does nothing with no channels', () => {
  expect(() => backfillAgentMessageEvent()).not.toThrow();
  expect(q.listNotificationChannels()).toEqual([]);
});
