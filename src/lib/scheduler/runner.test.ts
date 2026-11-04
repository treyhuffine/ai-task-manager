/**
 * Tick-level behavior of the scheduler runner — at-most-once semantics
 * for one-off triggers, the active-hours skip, and the lock-held
 * branch's quiet idempotency.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WORK_DIR_ENV } from '@/lib/config/paths';

vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true } }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));
vi.mock('@/lib/executor/adapter', () => ({
  dispatch: vi.fn(async () => {}),
  ExecutorError: class extends Error {},
}));

// Lets a test hold one fire open, as a lookup that never comes back would.
const firing = vi.hoisted(() => ({ holdNext: null as Promise<void> | null }));
vi.mock('@/lib/runs/dispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/runs/dispatch')>();
  return {
    ...actual,
    dispatchRun: async (args: Parameters<typeof actual.dispatchRun>[0]) => {
      const hold = firing.holdNext;
      firing.holdNext = null;
      if (hold) await hold;
      return actual.dispatchRun(args);
    },
  };
});

const TEST_DB = path.join(os.tmpdir(), `ri-runner-test-${process.pid}.db`);
const TEST_BRAIN = path.join(os.tmpdir(), `ri-runner-brain-${process.pid}`);

beforeEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.rmSync(TEST_BRAIN, { recursive: true, force: true });
  fs.mkdirSync(TEST_BRAIN, { recursive: true });
  process.env.RI_DB_PATH = TEST_DB;
  process.env.RI_BRAIN_PATH = TEST_BRAIN;
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.rmSync(TEST_BRAIN, { recursive: true, force: true });
});

async function seed() {
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  const db = getDb();
  const { uuidv7 } = await import('uuidv7');
  const { workspaces } = await import('@/lib/db/schema');
  const wsId = uuidv7();
  db.insert(workspaces).values({
    id: wsId, name: 'TestWs', slug: 'testws-' + Date.now(),
    cwd: '/tmp/testws', isGit: false, status: 'active', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: true,
  }).run();
  return { wsId };
}

describe('runTick — at-most-once for one-off triggers', () => {
  it('fires a kind=at trigger exactly once across multiple ticks', async () => {
    const { wsId } = await seed();
    const queries = await import('@/lib/db/queries');
    const { runTick } = await import('./runner');

    // Past runAt — would be immediately due on first tick.
    const past = new Date(Date.now() - 60_000).toISOString();
    queries.createTrigger({
      name: 'one-shot',
      workspaceId: wsId,
      targetKind: 'workspace',
      harness: 'claude',
      prompt: 'X',
      kind: 'at',
      runAt: past,
      nextRunAt: past,
    });

    const now = new Date();
    const fired1 = await runTick(now);
    // Let any fire-and-forget settle.
    await new Promise((r) => setTimeout(r, 50));
    const fired2 = await runTick(new Date(now.getTime() + 1000));
    await new Promise((r) => setTimeout(r, 50));
    const fired3 = await runTick(new Date(now.getTime() + 2000));

    const runs = queries.listRuns({});
    const real = runs.filter((r) => r.status !== 'skipped');
    expect(fired1).toBe(1);
    expect(fired2).toBe(0);
    expect(fired3).toBe(0);
    expect(real.length).toBe(1);
  });

  it('every trigger keeps advancing past now after each fire', async () => {
    await seed();
    const queries = await import('@/lib/db/queries');
    const { runTick } = await import('./runner');

    const past = new Date(Date.now() - 120_000).toISOString();
    queries.createTrigger({
      name: 'tick',
      targetKind: 'orchestrator',
      harness: 'claude',
      prompt: 'X',
      kind: 'every',
      intervalSeconds: 60,
      nextRunAt: past,
    });

    await runTick(new Date());
    await new Promise((r) => setTimeout(r, 50));
    const triggers = queries.listTriggers({});
    expect(triggers[0]?.nextRunAt).toBeDefined();
    // nextRunAt should now be in the future.
    expect(new Date(triggers[0]!.nextRunAt!).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('fires an overdue trigger once, not once per missed interval, when the home next ticks (P3.4)', async () => {
    await seed();
    const queries = await import('@/lib/db/queries');
    const { runTick } = await import('./runner');

    // Ten intervals missed while the home was asleep.
    const trigger = queries.createTrigger({
      name: 'every minute',
      targetKind: 'orchestrator',
      harness: 'claude',
      prompt: 'X',
      kind: 'every',
      intervalSeconds: 60,
      nextRunAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    });

    await runTick(new Date());
    await runTick(new Date());
    await new Promise((r) => setTimeout(r, 50));
    expect(queries.listRuns({}).filter((r) => r.triggerId === trigger.id)).toHaveLength(1);
    expect(new Date(queries.getTrigger(trigger.id)!.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('runTick — a failed tick never stops the scheduler', () => {
  it('logs the failure and fires on the next tick after the lock file could not be created', async () => {
    await seed();
    const queries = await import('@/lib/db/queries');
    const { runTick } = await import('./runner');
    const trigger = queries.createTrigger({
      name: 'nightly',
      targetKind: 'orchestrator',
      harness: 'claude',
      prompt: 'X',
      kind: 'every',
      intervalSeconds: 60,
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    });

    // A full disk refuses the lock file the same way: any open error but
    // EEXIST throws. A work "folder" that is a file gives ENOTDIR, and works
    // for any user, where a read-only folder wouldn't stop root.
    const blockedWorkDir = path.join(TEST_BRAIN, 'not-a-folder');
    fs.writeFileSync(blockedWorkDir, '');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env[WORK_DIR_ENV] = blockedWorkDir;
    try {
      expect(await runTick(new Date())).toBe(0);
    } finally {
      delete process.env[WORK_DIR_ENV];
    }
    expect(logged).toHaveBeenCalledWith('[scheduler] tick failed:', expect.objectContaining({ code: 'ENOTDIR' }));
    logged.mockRestore();
    expect(queries.listRuns({}).filter((r) => r.triggerId === trigger.id)).toHaveLength(0);

    // Space came back: the very next tick works and fires what was due.
    expect(await runTick(new Date())).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(queries.listRuns({}).filter((r) => r.triggerId === trigger.id)).toHaveLength(1);
  });
});

describe('runTick — a stuck tick never stops the scheduler', () => {
  it('lets a new tick take over after 10 minutes, and fires no job twice', async () => {
    await seed();
    const queries = await import('@/lib/db/queries');
    const { runTick, getSchedulerStats } = await import('./runner');
    const t0 = Date.now();
    const daily = (name: string) => queries.createTrigger({
      name,
      targetKind: 'orchestrator',
      harness: 'claude',
      prompt: 'X',
      kind: 'every',
      intervalSeconds: 86_400,
      nextRunAt: new Date(t0 - 60_000).toISOString(),
    });
    const jobs = [daily('first'), daily('second')];

    let release!: () => void;
    firing.holdNext = new Promise((resolve) => { release = resolve; });
    const stuck = runTick(new Date(t0));
    await vi.waitFor(() => expect(firing.holdNext).toBeNull());

    // A slow tick isn't a stuck one: the next minute leaves it alone.
    expect(await runTick(new Date(t0 + 60_000))).toBe(0);

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runTick(new Date(t0 + 11 * 60_000))).toBe(1);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('stuck for 11 minutes'));
    logged.mockRestore();

    // The lookup comes back at last. The old tick ends what it was doing and
    // doesn't go on through its older list, which still has the job just fired.
    release();
    expect(await stuck).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    for (const job of jobs) expect(queries.listRuns({}).filter((r) => r.triggerId === job.id)).toHaveLength(1);

    expect(getSchedulerStats().ticking).toBe(false);
    expect(await runTick(new Date(t0 + 12 * 60_000))).toBe(0);
    expect(getSchedulerStats().ticking).toBe(false);
  });
});

describe('runTick — how late a fire was', () => {
  it('records the slot it was due and says so in the message of a late run', async () => {
    await seed();
    const queries = await import('@/lib/db/queries');
    const { runTick } = await import('./runner');
    const due = new Date(Date.now() - 3 * 60 * 60_000 - 39 * 60_000 - 5_000).toISOString();
    const trigger = queries.createTrigger({
      name: 'morning',
      targetKind: 'orchestrator',
      harness: 'claude',
      prompt: 'Refresh the deck.',
      kind: 'cron',
      cronExpression: '0 5 * * *',
      timezone: 'America/Denver',
      nextRunAt: due,
    });

    expect(await runTick(new Date())).toBe(1);
    await new Promise((r) => setTimeout(r, 50));

    const run = queries.listRuns({}).find((r) => r.triggerId === trigger.id)!;
    expect(run.scheduledFor).toBe(due);
    const sent = queries.listChatEvents(run.chatSessionId!).find((e) => e.role === 'user')!;
    expect(sent.content).toMatch(/^This scheduled run was due at .+ and is starting 3h 39m late\. Check it still applies before acting on it\.\n\nRefresh the deck\.$/);
  });

  it('leaves the message of an on-time run alone', async () => {
    await seed();
    const queries = await import('@/lib/db/queries');
    const { runTick } = await import('./runner');
    const trigger = queries.createTrigger({
      name: 'morning',
      targetKind: 'orchestrator',
      harness: 'claude',
      prompt: 'Refresh the deck.',
      kind: 'every',
      intervalSeconds: 86_400,
      nextRunAt: new Date(Date.now() - 30_000).toISOString(),
    });

    await runTick(new Date());
    await new Promise((r) => setTimeout(r, 50));

    const run = queries.listRuns({}).find((r) => r.triggerId === trigger.id)!;
    expect(queries.listChatEvents(run.chatSessionId!).find((e) => e.role === 'user')?.content).toBe('Refresh the deck.');
  });
});
