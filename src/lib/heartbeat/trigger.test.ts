/**
 * The heartbeat trigger against a real (temp) database: seeding, scheduling
 * inside the active hours, and the status it reports. See
 * docs/heartbeat-spec.md §4 and §5.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true } }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));

vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

const TEST_DB = path.join(os.tmpdir(), `ri-heartbeat-trigger-test-${process.pid}.db`);

function wipe() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

beforeEach(async () => {
  wipe();
  process.env.RI_DB_PATH = TEST_DB;
  const { resetDb } = await import('@/lib/db');
  resetDb();
});

afterAll(wipe);

const HEARTBEAT_ID = '00000000-0000-0000-0000-000000000005';
const UTC_HOURS = { activeHoursStart: '09:00', activeHoursEnd: '21:00', timezone: 'UTC' };

describe('ensureHeartbeatTrigger', () => {
  it('seeds the reserved row off, orchestrator-targeted, with the default instructions and bounded behavior', async () => {
    const { ensureHeartbeatTrigger } = await import('./trigger');
    const { DEFAULT_HEARTBEAT_INSTRUCTIONS } = await import('./constants');
    const row = ensureHeartbeatTrigger()!;
    expect(row).toMatchObject({
      id: HEARTBEAT_ID,
      name: 'Heartbeat',
      enabled: false,
      targetKind: 'orchestrator',
      workspaceId: null,
      kind: 'every',
      intervalSeconds: 3600,
      activeHoursStart: '09:00',
      activeHoursEnd: '21:00',
      concurrencyPolicy: 'skip_if_running',
      catchUpPolicy: 'skip_missed',
      timeoutSeconds: 1800,
      nextRunAt: null,
      prompt: DEFAULT_HEARTBEAT_INSTRUCTIONS,
    });
  });

  it('is idempotent and never turns a row back on', async () => {
    const { ensureHeartbeatTrigger, updateHeartbeat } = await import('./trigger');
    const queries = await import('@/lib/db/queries');
    ensureHeartbeatTrigger();
    updateHeartbeat({ enabled: true });
    updateHeartbeat({ enabled: false });
    ensureHeartbeatTrigger();
    ensureHeartbeatTrigger();
    expect(queries.listTriggers({}).filter((t) => t.id === HEARTBEAT_ID)).toHaveLength(1);
    expect(queries.getTrigger(HEARTBEAT_ID)!.enabled).toBe(false);
  });

  it("takes the fallback name when the user already owns a trigger called Heartbeat, and leaves theirs alone", async () => {
    const queries = await import('@/lib/db/queries');
    const mine = queries.createTrigger({
      name: 'Heartbeat', harness: 'claude', targetKind: 'orchestrator', workspaceId: null,
      prompt: 'my own', kind: 'manual',
    });
    const { ensureHeartbeatTrigger } = await import('./trigger');
    const row = ensureHeartbeatTrigger()!;
    expect(row.id).toBe(HEARTBEAT_ID);
    expect(row.name).toBe('Ri heartbeat');
    expect(queries.getTrigger(mine.id)).toMatchObject({ name: 'Heartbeat', prompt: 'my own' });
  });
});

describe('scheduling inside the active hours', () => {
  it('firstInWindow keeps an in-window time and moves an out-of-window time to the next opening', async () => {
    const { firstInWindow } = await import('./trigger');
    const inside = new Date('2026-09-22T14:30:00Z');
    expect(firstInWindow(inside, UTC_HOURS)).toEqual(inside);
    expect(firstInWindow(new Date('2026-09-22T22:30:00Z'), UTC_HOURS).toISOString()).toBe('2026-09-23T09:00:00.000Z');
    expect(firstInWindow(new Date('2026-09-22T22:30:00Z'), { ...UTC_HOURS, activeHoursStart: null, activeHoursEnd: null }))
      .toEqual(new Date('2026-09-22T22:30:00Z'));
  });

  it('turning on schedules one interval out, moved into the window', async () => {
    const { ensureHeartbeatTrigger, updateHeartbeat } = await import('./trigger');
    const queries = await import('@/lib/db/queries');
    ensureHeartbeatTrigger();
    queries.updateTrigger(HEARTBEAT_ID, { timezone: 'UTC' });

    updateHeartbeat({ enabled: true }, new Date('2026-09-22T14:00:00Z'));
    expect(queries.getTrigger(HEARTBEAT_ID)!.nextRunAt).toBe('2026-09-22T15:00:00.000Z');

    updateHeartbeat({ enabled: false });
    updateHeartbeat({ enabled: true }, new Date('2026-09-22T20:30:00Z'));
    // 21:30 is after hours, so the first check-in waits for 09:00.
    expect(queries.getTrigger(HEARTBEAT_ID)!.nextRunAt).toBe('2026-09-23T09:00:00.000Z');
  });

  it('a daily cadence turned on late at night anchors inside the window instead of never firing', async () => {
    const { ensureHeartbeatTrigger, updateHeartbeat } = await import('./trigger');
    const queries = await import('@/lib/db/queries');
    ensureHeartbeatTrigger();
    queries.updateTrigger(HEARTBEAT_ID, { timezone: 'UTC' });
    updateHeartbeat({ enabled: true, intervalSeconds: 86400 }, new Date('2026-09-22T22:30:00Z'));
    expect(queries.getTrigger(HEARTBEAT_ID)!.nextRunAt).toBe('2026-09-23T09:00:00.000Z');
  });

  it('before the window opens, the first check-in is the opening, not a whole interval later', async () => {
    const { scheduleFirstCheckIn } = await import('./trigger');
    // Daily, turned on at 08:00: today at 09:00, not tomorrow.
    expect(scheduleFirstCheckIn(86400, UTC_HOURS, new Date('2026-09-22T08:00:00Z'))).toBe('2026-09-22T09:00:00.000Z');
    // Half-hourly, turned on at 08:45: the opening (09:00) beats one interval (09:15).
    expect(scheduleFirstCheckIn(1800, UTC_HOURS, new Date('2026-09-22T08:45:00Z'))).toBe('2026-09-22T09:00:00.000Z');
    // Inside the window: always one interval out.
    expect(scheduleFirstCheckIn(86400, UTC_HOURS, new Date('2026-09-22T14:00:00Z'))).toBe('2026-09-23T14:00:00.000Z');
  });

  it('retrying the same interval does not push the next check-in back', async () => {
    const { ensureHeartbeatTrigger, updateHeartbeat } = await import('./trigger');
    const queries = await import('@/lib/db/queries');
    ensureHeartbeatTrigger();
    queries.updateTrigger(HEARTBEAT_ID, { timezone: 'UTC' });
    updateHeartbeat({ enabled: true, intervalSeconds: 7200 }, new Date('2026-09-22T10:00:00Z'));
    const first = queries.getTrigger(HEARTBEAT_ID)!.nextRunAt;
    updateHeartbeat({ enabled: true, intervalSeconds: 7200 }, new Date('2026-09-22T11:00:00Z'));
    expect(queries.getTrigger(HEARTBEAT_ID)!.nextRunAt).toBe(first);
  });

  it('turning on clears an app-set pause reason', async () => {
    const { ensureHeartbeatTrigger, updateHeartbeat } = await import('./trigger');
    const queries = await import('@/lib/db/queries');
    ensureHeartbeatTrigger();
    queries.updateTrigger(HEARTBEAT_ID, { enabled: false, disabledReason: 'budget_exceeded' });
    expect(updateHeartbeat({ enabled: true }).disabledReason).toBeNull();
  });

  it('nextCheckInAt skips slots the scheduler will drop for falling after hours', async () => {
    const { nextCheckInAt } = await import('./trigger');
    const base = {
      enabled: true, intervalSeconds: 3600, ...UTC_HOURS,
    } as Parameters<typeof nextCheckInAt>[0];
    expect(nextCheckInAt({ ...base, nextRunAt: '2026-09-22T21:15:00.000Z' })).toBe('2026-09-23T09:15:00.000Z');
    expect(nextCheckInAt({ ...base, nextRunAt: '2026-09-22T15:15:00.000Z' })).toBe('2026-09-22T15:15:00.000Z');
    expect(nextCheckInAt({ ...base, enabled: false, nextRunAt: '2026-09-22T15:15:00.000Z' })).toBeNull();
  });
});

describe('getHeartbeatConfig', () => {
  it('seeds on first read and reports defaults', async () => {
    const { getHeartbeatConfig } = await import('./trigger');
    const config = getHeartbeatConfig();
    expect(config).toMatchObject({
      triggerId: HEARTBEAT_ID,
      enabled: false,
      instructionsAreDefault: true,
      intervalSeconds: 3600,
      provider: 'claude',
      nextCheckInAt: null,
      running: false,
      lastCheckIn: null,
    });
  });

  it('reports the latest real check-in (skips skipped slots), with quiet, unread, and change count', async () => {
    const { getHeartbeatConfig, ensureHeartbeatTrigger } = await import('./trigger');
    const queries = await import('@/lib/db/queries');
    ensureHeartbeatTrigger();
    const chat = queries.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' });

    queries.createRun({
      triggerId: HEARTBEAT_ID, harness: 'claude', triggerKind: 'every', status: 'completed',
      chatSessionId: chat.id, startedAt: '2026-09-22T10:00:00.000Z', completedAt: '2026-09-22T10:01:00.000Z',
      artifactRefs: [{ kind: 'task', id: 't1' }, { kind: 'note', id: 'n1' }],
      createdAt: '2026-09-22T10:00:00.000Z',
    });
    queries.bumpSessionOutcome(chat.id);
    // A later slot skipped because the previous check-in was still running.
    queries.createRun({
      triggerId: HEARTBEAT_ID, harness: 'claude', triggerKind: 'every', status: 'skipped',
      statusReason: 'trigger_busy', createdAt: '2026-09-22T11:00:00.000Z',
    });

    const { lastCheckIn } = getHeartbeatConfig();
    expect(lastCheckIn).toMatchObject({
      status: 'completed', quiet: false, chatSessionId: chat.id, unread: true, changedCount: 2,
      at: '2026-09-22T10:00:00.000Z',
    });
  });

  it('marks a quiet check-in as quiet and not unread', async () => {
    const { getHeartbeatConfig, ensureHeartbeatTrigger } = await import('./trigger');
    const queries = await import('@/lib/db/queries');
    ensureHeartbeatTrigger();
    const chat = queries.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' });
    queries.bumpSessionOutcome(chat.id);
    queries.archiveChatSession(chat.id);
    queries.createRun({
      triggerId: HEARTBEAT_ID, harness: 'claude', triggerKind: 'every', status: 'completed',
      statusReason: 'heartbeat_quiet', summary: 'Nothing needed', chatSessionId: chat.id,
    });
    expect(getHeartbeatConfig().lastCheckIn).toMatchObject({ quiet: true, unread: false, changedCount: 0 });
  });
});
