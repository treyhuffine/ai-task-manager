import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DB = path.join(os.tmpdir(), `flow-deck-trigger-test-${process.pid}.db`);

function rm() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

beforeEach(() => {
  rm();
  process.env.FLOW_DB_PATH = TEST_DB;
});
afterAll(rm);

async function setup() {
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
  return {
    sched: await import('./trigger'),
    q: await import('@/lib/db/queries'),
  };
}

describe('morning deck trigger', () => {
  it('defaults to off when no trigger exists', async () => {
    const { sched } = await setup();
    expect(sched.getMorningDeckConfig().enabled).toBe(false);
    expect(sched.getMorningDeckTrigger()).toBeNull();
  });

  it('creates an orchestrator cron trigger and round-trips the time', async () => {
    const { sched, q } = await setup();
    const cfg = sched.setMorningDeckConfig({ enabled: true, time: '04:30' });
    expect(cfg).toEqual(expect.objectContaining({ enabled: true, time: '04:30' }));

    const row = sched.getMorningDeckTrigger()!;
    expect(row.kind).toBe('cron');
    expect(row.targetKind).toBe('orchestrator');
    expect(row.cronExpression).toBe('30 4 * * *');
    expect(row.enabled).toBe(true);
    expect(row.nextRunAt).toBeTruthy();
    // Brain-level trigger, exactly one.
    expect(q.listTriggers().filter((s) => s.name === sched.MORNING_DECK_TRIGGER_NAME).length).toBe(1);
  });

  it('is idempotent — toggling updates the same row, no duplicate', async () => {
    const { sched, q } = await setup();
    sched.setMorningDeckConfig({ enabled: true, time: '05:00' });
    const after = sched.setMorningDeckConfig({ enabled: false });

    expect(after.enabled).toBe(false);
    expect(after.time).toBe('05:00'); // time preserved across an enable toggle
    expect(q.listTriggers().filter((s) => s.name === sched.MORNING_DECK_TRIGGER_NAME).length).toBe(1);
  });

  it('stores the row under the reserved sentinel id', async () => {
    const { sched } = await setup();
    const { RESERVED_TRIGGER_IDS } = await import('@/lib/triggers/reserved');
    sched.setMorningDeckConfig({ enabled: true, time: '04:00' });
    expect(sched.getMorningDeckTrigger()!.id).toBe(RESERVED_TRIGGER_IDS.morningDeck);
  });

  it('survives a rename of the display name — id-linked, never orphaned', async () => {
    const { sched, q } = await setup();
    const { RESERVED_TRIGGER_IDS } = await import('@/lib/triggers/reserved');
    sched.setMorningDeckConfig({ enabled: true, time: '06:15' });

    // Simulate an edit in the generic UI that frees the name.
    q.updateTrigger(RESERVED_TRIGGER_IDS.morningDeck, { name: 'Renamed by user' });

    // Config still resolves it, and a toggle updates the SAME row (no dup).
    const cfg = sched.setMorningDeckConfig({ enabled: false });
    expect(cfg.time).toBe('06:15');
    expect(sched.getMorningDeckTrigger()!.id).toBe(RESERVED_TRIGGER_IDS.morningDeck);
    expect(q.listTriggers().length).toBe(1);
  });
});

describe('ensureMorningDeckTrigger', () => {
  it('seeds an enabled row when absent, and a disable survives re-ensure', async () => {
    const { sched, q } = await setup();
    expect(sched.getMorningDeckTrigger()).toBeNull();

    sched.ensureMorningDeckTrigger();
    expect(sched.getMorningDeckTrigger()).toBeTruthy();
    expect(sched.getMorningDeckConfig().enabled).toBe(true); // DEFAULT_MORNING_ENABLED

    // User disables, process restarts (ensure runs again) — must NOT re-enable.
    sched.setMorningDeckConfig({ enabled: false });
    sched.ensureMorningDeckTrigger();
    expect(sched.getMorningDeckConfig().enabled).toBe(false);
    expect(q.listTriggers().length).toBe(1);
  });

  it('adopts a legacy name-linked row once, carrying its schedule', async () => {
    const { sched, q } = await setup();
    const { RESERVED_TRIGGER_IDS } = await import('@/lib/triggers/reserved');

    // Pre-fix row: created with a generated id, linked only by name.
    const orch = q.getOrCreateDefaultOrchestrator();
    const legacy = q.createTrigger({
      name: sched.MORNING_DECK_TRIGGER_NAME,
      description: 'legacy',
      enabled: true,
      agentId: orch.id,
      workspaceId: null,
      targetKind: 'orchestrator',
      prompt: 'legacy prompt',
      kind: 'cron',
      cronExpression: '15 7 * * *',
      timezone: 'UTC',
      nextRunAt: new Date().toISOString(),
    });
    expect(legacy.id).not.toBe(RESERVED_TRIGGER_IDS.morningDeck);

    sched.ensureMorningDeckTrigger();

    // Settings carried over, stray removed, exactly one row under the sentinel.
    expect(sched.getMorningDeckTrigger()!.id).toBe(RESERVED_TRIGGER_IDS.morningDeck);
    expect(sched.getMorningDeckConfig().enabled).toBe(true);
    expect(sched.getMorningDeckConfig().time).toBe('07:15');
    expect(q.getTrigger(legacy.id)).toBeUndefined();
    expect(q.listTriggers().length).toBe(1);
  });
});

describe('reserved-trigger guardrails (via orchestrator actions)', () => {
  async function withReservedRow() {
    const ctx = await setup();
    const { runAction } = await import('@/lib/orchestrator/dispatch');
    const { RESERVED_TRIGGER_IDS } = await import('@/lib/triggers/reserved');
    ctx.sched.ensureMorningDeckTrigger();
    return { ...ctx, runAction, id: RESERVED_TRIGGER_IDS.morningDeck };
  }

  it('rejects identity-field edits on the reserved row', async () => {
    const { runAction, id } = await withReservedRow();
    const env = await runAction('update_trigger', { id, prompt: 'hijacked' }, { remote: false });
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('conflict');
  });

  it('allows schedule edits on the reserved row', async () => {
    const { runAction, id, sched } = await withReservedRow();
    const env = await runAction('update_trigger', { id, cronExpression: '0 9 * * *' }, { remote: false });
    expect(env.ok).toBe(true);
    expect(sched.getMorningDeckConfig().time).toBe('09:00');
  });

  it('blocks deletion of the reserved row', async () => {
    const { runAction, id, sched } = await withReservedRow();
    const env = await runAction('delete_trigger', { id }, { remote: false });
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('conflict');
    expect(sched.getMorningDeckTrigger()).toBeTruthy(); // still there
  });
});
