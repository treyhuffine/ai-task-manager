import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DB = path.join(os.tmpdir(), `flow-pin-test-${process.pid}.db`);

beforeEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  process.env.FLOW_DB_PATH = TEST_DB;
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

async function setup() {
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
  return import('@/lib/db/queries');
}

async function makeWorkspace(slugTag: string): Promise<string> {
  const { getDb } = await import('@/lib/db');
  const { workspaces } = await import('@/lib/db/schema');
  const { uuidv7 } = await import('uuidv7');
  const wsId = uuidv7();
  getDb().insert(workspaces).values({
    id: wsId, name: 'Ws', slug: `ws-${slugTag}-${Date.now()}`, cwd: `/tmp/${slugTag}`, isGit: false,
  }).run();
  return wsId;
}

/**
 * Pinning is a transient working-set marker on the *execution*, driven by
 * session id everywhere the rail addresses rows. The contract these tests
 * lock in: the stamp round-trips, archiving clears it (a pin never outlives
 * its active work), and the rail carries the state so the Pinned group can
 * derive from the existing rail query rather than a second fetch.
 */
describe('execution pin', () => {
  it('stamps and clears pinnedAt via setExecutionPinned', async () => {
    const q = await setup();
    const wsId = await makeWorkspace('pin1');
    const executor = q.getOrCreateDefaultExecutor('claude_code');
    const { execution } = q.createExecutionWithChat({ workspaceId: wsId, agentId: executor.id, label: 'Work' });

    expect(q.getExecution(execution.id)?.pinnedAt).toBeNull();

    q.setExecutionPinned(execution.id, true);
    expect(q.getExecution(execution.id)?.pinnedAt).toEqual(expect.any(String));

    q.setExecutionPinned(execution.id, false);
    expect(q.getExecution(execution.id)?.pinnedAt).toBeNull();
  });

  it('toggles via the session id and returns the execution flattened', async () => {
    const q = await setup();
    const wsId = await makeWorkspace('pin2');
    const executor = q.getOrCreateDefaultExecutor('claude_code');
    const { session, execution } = q.createExecutionWithChat({ workspaceId: wsId, agentId: executor.id, label: 'Work' });

    const pinned = q.setSessionPinned(session.id, true);
    expect(pinned?.execution?.pinnedAt).toEqual(expect.any(String));
    expect(q.getExecution(execution.id)?.pinnedAt).toEqual(expect.any(String));

    const unpinned = q.setSessionPinned(session.id, false);
    expect(unpinned?.execution?.pinnedAt).toBeNull();
  });

  it('returns null for an unknown session', async () => {
    const q = await setup();
    expect(q.setSessionPinned('does-not-exist', true)).toBeNull();
  });

  it('auto-clears the pin when the execution is archived', async () => {
    const q = await setup();
    const wsId = await makeWorkspace('pin3');
    const executor = q.getOrCreateDefaultExecutor('claude_code');
    const { session, execution } = q.createExecutionWithChat({ workspaceId: wsId, agentId: executor.id, label: 'Work' });

    q.setSessionPinned(session.id, true);
    expect(q.getExecution(execution.id)?.pinnedAt).toEqual(expect.any(String));

    q.archiveExecution(execution.id);
    const archived = q.getExecution(execution.id);
    expect(archived?.status).toBe('archived');
    expect(archived?.pinnedAt).toBeNull();
  });

  it('surfaces the pin on rail rows so the Pinned group derives from rail data', async () => {
    const q = await setup();
    const wsId = await makeWorkspace('pin4');
    const executor = q.getOrCreateDefaultExecutor('claude_code');
    const a = q.createExecutionWithChat({ workspaceId: wsId, agentId: executor.id, label: 'Pinned one' });
    q.createExecutionWithChat({ workspaceId: wsId, agentId: executor.id, label: 'Not pinned' });

    q.setSessionPinned(a.session.id, true);

    const rail = q.listRailSessions();
    const pinnedRows = rail.filter((r) => !!r.execution?.pinnedAt);
    expect(pinnedRows.map((r) => r.execution?.label)).toEqual(['Pinned one']);
  });
});
