/**
 * Notifier outbox behavior (docs/connectors-email-and-notifier-spec.md §2.15/§2.16). Exercises the
 * real DB + notify() pipeline with an injected fake adapter (no real Telegram/web-push). Proves the
 * properties typecheck can't: idempotency, fan-out, matrix vs binding routing, self-healing retry,
 * and the cascades.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isNotifierDelivery } from './caller';
import type { NotificationChannelAdapter, NotificationEvent } from './types';

const TEST_DB = path.join(os.tmpdir(), `flow-notify-test-${process.pid}.db`);

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

beforeEach(() => {
  cleanup();
  process.env.FLOW_DB_PATH = TEST_DB;
});
afterAll(cleanup);

async function mod() {
  const { resetDb, getDb } = await import('@/lib/db');
  resetDb();
  getDb(); // auto-migrates (includes 0033 notifier tables)
  const queries = await import('@/lib/db/queries');
  const { notify } = await import('./notify');
  return { queries, notify };
}

function fakeAdapter(opts: { fail?: () => boolean } = {}) {
  const calls: Array<{ channelId: string; title: string }> = [];
  const adapter: NotificationChannelAdapter = {
    kind: 'connector',
    providerId: 'test',
    async deliver(channel, rendered) {
      if (opts.fail?.()) throw new Error('boom');
      calls.push({ channelId: channel.id, title: rendered.title });
      return { providerMessageId: 'm1' };
    },
  };
  return { adapter, calls, deps: { resolveAdapter: () => adapter } };
}

function evt(over: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    type: 'execution.finished',
    userId: 'local',
    dedupeKey: 'execution.finished:run1',
    title: 'Fix auth',
    body: 'Tests pass.',
    url: '/?session=chat1',
    ...over,
  };
}

describe('notify() outbox', () => {
  it('fans out to subscribed enabled channels only (skips unsubscribed + disabled)', async () => {
    const { queries, notify } = await mod();
    const { adapter, calls } = fakeAdapter();
    queries.createNotificationChannel({ userId: 'local', kind: 'connector', providerId: 'test', config: {}, events: ['execution.finished'], enabled: true });
    queries.createNotificationChannel({ userId: 'local', kind: 'connector', providerId: 'test', config: {}, events: ['execution.needs_input'], enabled: true }); // not subscribed
    queries.createNotificationChannel({ userId: 'local', kind: 'connector', providerId: 'test', config: {}, events: ['execution.finished'], enabled: false }); // disabled

    await notify(evt(), {}, { resolveAdapter: () => adapter });

    expect(calls).toHaveLength(1);
    const deliveries = queries.listNotificationDeliveries('local');
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe('sent');
    expect(deliveries[0]!.providerMessageId).toBe('m1');
  });

  it('is idempotent on (dedupeKey, channelId) — a re-fire never double-sends', async () => {
    const { queries, notify } = await mod();
    const { adapter, calls, deps } = fakeAdapter();
    queries.createNotificationChannel({ userId: 'local', kind: 'connector', providerId: 'test', config: {}, events: ['execution.finished'], enabled: true });

    await notify(evt(), {}, deps);
    await notify(evt(), {}, deps); // same dedupeKey (reconcile replay / restart)

    expect(calls).toHaveLength(1);
    expect(queries.listNotificationDeliveries('local')).toHaveLength(1);
  });

  it('self-heals: a failed delivery retries on the next re-fire', async () => {
    const { queries, notify } = await mod();
    let down = true;
    const { adapter, calls } = fakeAdapter({ fail: () => down });
    queries.createNotificationChannel({ userId: 'local', kind: 'connector', providerId: 'test', config: {}, events: ['execution.finished'], enabled: true });

    await notify(evt(), {}, { resolveAdapter: () => adapter });
    let d = queries.listNotificationDeliveries('local');
    expect(d[0]!.status).toBe('failed');
    expect(d[0]!.lastError).toContain('boom');
    expect(d[0]!.attempts).toBe(1);

    down = false;
    await notify(evt(), {}, { resolveAdapter: () => adapter }); // re-fire
    d = queries.listNotificationDeliveries('local');
    expect(d[0]!.status).toBe('sent');
    expect(calls).toHaveLength(1); // the successful send
  });

  it('binding routing delivers to deliverTo channels, ignoring their events[] matrix', async () => {
    const { queries, notify } = await mod();
    const { adapter, calls } = fakeAdapter();
    const ch = queries.createNotificationChannel({ userId: 'local', kind: 'connector', providerId: 'test', config: {}, events: [], enabled: true });

    await notify(
      evt({ type: 'trigger.run_completed', dedupeKey: 'trigger.run_completed:run9' }),
      { deliverTo: [ch.id] },
      { resolveAdapter: () => adapter },
    );

    expect(calls).toHaveLength(1);
  });

  it('marks a delivery failed when no adapter resolves', async () => {
    const { queries, notify } = await mod();
    queries.createNotificationChannel({ userId: 'local', kind: 'connector', providerId: 'unknown', config: {}, events: ['execution.finished'], enabled: true });
    await notify(evt(), {}, { resolveAdapter: () => undefined });
    const d = queries.listNotificationDeliveries('local');
    expect(d[0]!.status).toBe('failed');
    expect(d[0]!.lastError).toContain('no adapter');
  });
});

describe('cascades', () => {
  it('deleteChannelsForConnection drops channels for a removed connection', async () => {
    const { queries } = await mod();
    queries.createNotificationChannel({ userId: 'local', kind: 'connector', providerId: 'telegram', connectionId: 'conn1', config: {}, events: [], enabled: true });
    queries.createNotificationChannel({ userId: 'local', kind: 'connector', providerId: 'telegram', connectionId: 'conn2', config: {}, events: [], enabled: true });
    const removed = queries.deleteChannelsForConnection('conn1');
    expect(removed).toBe(1);
    expect(queries.listNotificationChannels({ userId: 'local' })).toHaveLength(1);
  });

  it('deleting a channel scrubs it from trigger deliverResultTo bindings', async () => {
    const { queries } = await mod();
    const { getDb } = await import('@/lib/db');
    const { uuidv7 } = await import('uuidv7');
    const { agents } = await import('@/lib/db/schema');
    const agentId = uuidv7();
    getDb().insert(agents).values({ id: agentId, userId: 'local', kind: 'executor', name: 'Orch', harness: 'claude_code', config: {}, status: 'active' }).run();

    const ch = queries.createNotificationChannel({ userId: 'local', kind: 'connector', providerId: 'telegram', config: {}, events: [], enabled: true });
    const sched = queries.createTrigger({
      userId: 'local', name: 'digest', agentId, targetKind: 'orchestrator', prompt: 'summarize',
      kind: 'cron', cronExpression: '0 9 * * *', timezone: 'UTC', deliverResultTo: [ch.id],
    });
    expect(queries.getTrigger(sched.id)!.deliverResultTo).toEqual([ch.id]);

    queries.deleteNotificationChannel(ch.id);
    expect(queries.getTrigger(sched.id)!.deliverResultTo).toEqual([]);
  });
});

describe('narrow approval bypass', () => {
  it('allows only the notifier caller + allowlisted delivery actions', () => {
    const notifier = { type: 'app' as const, id: 'notifier' };
    expect(isNotifierDelivery(notifier, 'telegram.send_message')).toBe(true);
    expect(isNotifierDelivery(notifier, 'gmail.send_email')).toBe(false); // not a delivery action
    expect(isNotifierDelivery({ type: 'agent' }, 'telegram.send_message')).toBe(false); // not the notifier
    expect(isNotifierDelivery({ type: 'app', id: 'other' }, 'telegram.send_message')).toBe(false);
    expect(isNotifierDelivery(undefined, 'telegram.send_message')).toBe(false);
  });
});
