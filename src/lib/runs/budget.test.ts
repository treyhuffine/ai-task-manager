/**
 * Budget guard threshold transitions: ok → warn at 75%, warn → block
 * at 100%. Verifies the snapshot math + the auto-pause path in
 * dispatchRun.
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
vi.mock('@/lib/executor/adapter', () => ({
  dispatch: vi.fn(async () => {}),
  ExecutorError: class extends Error {},
}));

const TEST_DB = path.join(os.tmpdir(), `ri-budget-test-${process.pid}.db`);

beforeEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  process.env.RI_DB_PATH = TEST_DB;
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

async function seedWithSpend(opts: { budget: number | null; spend: number }) {
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  const db = getDb();
  const { uuidv7 } = await import('uuidv7');
  const { workspaces, runs, userState } = await import('@/lib/db/schema');
  const wsId = uuidv7();
  db.insert(workspaces).values({
    id: wsId, name: 'TestWs', slug: 'testws-' + Date.now(),
    cwd: '/tmp/testws', isGit: false, status: 'active', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: true,
  }).run();
  // Plant (or update) the user_state row with the budget — migrations
  // may have already seeded a default row, so use onConflictDoUpdate.
  db.insert(userState)
    .values({ id: 1, monthlyBudgetUsd: opts.budget })
    .onConflictDoUpdate({ target: userState.id, set: { monthlyBudgetUsd: opts.budget } })
    .run();
  // Plant a single run with the desired spend, scheduled this month.
  if (opts.spend > 0) {
    const now = new Date().toISOString();
    db.insert(runs).values({
      id: uuidv7(),
      workspaceId: wsId, harness: 'claude',
      triggerKind: 'manual', status: 'completed',
      costUsd: opts.spend,
      queuedAt: now, startedAt: now, completedAt: now, createdAt: now,
    }).run();
  }
  return { wsId };
}

describe('budget guard', () => {
  it('returns ok with no budget configured at any spend', async () => {
    await seedWithSpend({ budget: null, spend: 99.99 });
    const { budgetGate } = await import('./budget');
    expect(budgetGate()).toBe('ok');
  });

  it('crosses to warn at 75%', async () => {
    await seedWithSpend({ budget: 10, spend: 7.5 });
    const { budgetSnapshot } = await import('./budget');
    const snap = budgetSnapshot();
    expect(snap.state).toBe('warn');
    expect(snap.fraction).toBe(0.75);
  });

  it('crosses to block at 100%', async () => {
    await seedWithSpend({ budget: 10, spend: 10 });
    const { budgetGate, budgetSnapshot } = await import('./budget');
    const snap = budgetSnapshot();
    expect(snap.state).toBe('block');
    expect(budgetGate()).toBe('block');
  });

  it('dispatchRun auto-pauses the trigger when budget blocks', async () => {
    const { wsId } = await seedWithSpend({ budget: 1, spend: 5 });
    const queries = await import('@/lib/db/queries');
    const { dispatchRun } = await import('./dispatch');

    const sched = queries.createTrigger({
      name: 'over-budget',
      workspaceId: wsId, targetKind: 'workspace',
      harness: 'claude', prompt: 'X', kind: 'cron',
      cronExpression: '* * * * *',
    });
    const result = await dispatchRun({ trigger: sched, triggerKind: 'cron' });
    expect(result.run.status).toBe('skipped');
    expect(result.run.statusReason).toBe('budget_exceeded');

    const after = queries.getTrigger(sched.id)!;
    expect(after.enabled).toBe(false);
    expect(after.disabledReason).toBe('budget_exceeded');
  });
});
