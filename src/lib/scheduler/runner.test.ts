/**
 * Tick-level behavior of the scheduler runner — at-most-once semantics
 * for one-off triggers, the active-hours skip, and the lock-held
 * branch's quiet idempotency.
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

const TEST_DB = path.join(os.tmpdir(), `flow-runner-test-${process.pid}.db`);
const TEST_BRAIN = path.join(os.tmpdir(), `flow-runner-brain-${process.pid}`);

beforeEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.rmSync(TEST_BRAIN, { recursive: true, force: true });
  fs.mkdirSync(TEST_BRAIN, { recursive: true });
  process.env.FLOW_DB_PATH = TEST_DB;
  process.env.FLOW_BRAIN_PATH = TEST_BRAIN;
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
  const { workspaces, agents } = await import('@/lib/db/schema');
  const wsId = uuidv7();
  db.insert(workspaces).values({
    id: wsId, name: 'TestWs', slug: 'testws-' + Date.now(),
    cwd: '/tmp/testws', isGit: false,
  }).run();
  const agentId = uuidv7();
  db.insert(agents).values({
    id: agentId, userId: 'local', kind: 'executor',
    name: 'Test', harness: 'claude_code', config: {}, status: 'active',
  }).run();
  return { wsId, agentId };
}

describe('runTick — at-most-once for one-off triggers', () => {
  it('fires a kind=at trigger exactly once across multiple ticks', async () => {
    const { wsId, agentId } = await seed();
    const queries = await import('@/lib/db/queries');
    const { runTick } = await import('./runner');

    // Past runAt — would be immediately due on first tick.
    const past = new Date(Date.now() - 60_000).toISOString();
    queries.createTrigger({
      name: 'one-shot',
      workspaceId: wsId,
      targetKind: 'workspace',
      agentId,
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
    const { agentId } = await seed();
    const queries = await import('@/lib/db/queries');
    const { runTick } = await import('./runner');

    const past = new Date(Date.now() - 120_000).toISOString();
    queries.createTrigger({
      name: 'tick',
      targetKind: 'orchestrator',
      agentId,
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
});
