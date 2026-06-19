import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DB = path.join(os.tmpdir(), `flow-deck-schedule-test-${process.pid}.db`);

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
    sched: await import('./schedule'),
    q: await import('@/lib/db/queries'),
  };
}

describe('morning deck schedule', () => {
  it('defaults to off when no schedule exists', async () => {
    const { sched } = await setup();
    expect(sched.getMorningDeckConfig().enabled).toBe(false);
    expect(sched.getMorningDeckSchedule()).toBeNull();
  });

  it('creates an orchestrator cron schedule and round-trips the time', async () => {
    const { sched, q } = await setup();
    const cfg = sched.setMorningDeckConfig({ enabled: true, time: '04:30' });
    expect(cfg).toEqual(expect.objectContaining({ enabled: true, time: '04:30' }));

    const row = sched.getMorningDeckSchedule()!;
    expect(row.kind).toBe('cron');
    expect(row.targetKind).toBe('orchestrator');
    expect(row.cronExpression).toBe('30 4 * * *');
    expect(row.enabled).toBe(true);
    expect(row.nextRunAt).toBeTruthy();
    // Brain-level schedule, exactly one.
    expect(q.listSchedules().filter((s) => s.name === sched.MORNING_DECK_SCHEDULE_NAME).length).toBe(1);
  });

  it('is idempotent — toggling updates the same row, no duplicate', async () => {
    const { sched, q } = await setup();
    sched.setMorningDeckConfig({ enabled: true, time: '05:00' });
    const after = sched.setMorningDeckConfig({ enabled: false });

    expect(after.enabled).toBe(false);
    expect(after.time).toBe('05:00'); // time preserved across an enable toggle
    expect(q.listSchedules().filter((s) => s.name === sched.MORNING_DECK_SCHEDULE_NAME).length).toBe(1);
  });
});
