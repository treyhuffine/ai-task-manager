import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DB = path.join(os.tmpdir(), `flow-ws-executions-test-${process.pid}.db`);

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

/**
 * `includeArchived` is what the launcher's "Show archived" rides on. The tests
 * that matter here are about the *pair*: this query joins an execution to its
 * newest chat, and both halves carry a status. Relaxing one and not the other
 * produced a join that matched nothing, which looks identical to the flag
 * having no effect.
 */
describe('listWorkspaceExecutions', () => {
  it('hides archived executions by default and reveals them on request', async () => {
    const q = await setup();
    const { getDb } = await import('@/lib/db');
    const { workspaces } = await import('@/lib/db/schema');
    const { uuidv7 } = await import('uuidv7');

    const wsId = uuidv7();
    getDb().insert(workspaces).values({
      id: wsId, name: 'Ws', slug: `ws-${Date.now()}`, cwd: '/tmp/ws', isGit: false,
    }).run();
    const executor = q.getOrCreateDefaultExecutor('claude_code');

    const live = q.createExecutionWithChat({ workspaceId: wsId, agentId: executor.id, label: 'Live work' });
    const done = q.createExecutionWithChat({ workspaceId: wsId, agentId: executor.id, label: 'Finished work' });
    // Archive both halves, the way the archive path does. Either one alone
    // would leave a state the UI can't render consistently.
    q.archiveChatSession(done.session.id);
    q.archiveExecution(done.execution.id);

    const active = q.listWorkspaceExecutions(wsId);
    expect(active.map((r) => r.execution?.label)).toEqual(['Live work']);

    const all = q.listWorkspaceExecutions(wsId, { includeArchived: true });
    expect(all.map((r) => r.execution?.label).sort()).toEqual(['Finished work', 'Live work']);
    // The archived row has to arrive *marked*, since picking it in the launcher
    // reactivates the chat rather than merely opening it.
    expect(all.find((r) => r.execution?.label === 'Finished work')?.status).toBe('archived');
  });

  it('still returns an execution whose only chat is archived', async () => {
    // The regression this guards: the inner subquery picks the newest chat for
    // each execution and used to require `status = 'active'`. An execution
    // whose chats are all archived then joined to nothing and vanished even
    // with includeArchived on, so the flag appeared to do nothing for exactly
    // the rows it exists to surface.
    const q = await setup();
    const { getDb } = await import('@/lib/db');
    const { workspaces } = await import('@/lib/db/schema');
    const { uuidv7 } = await import('uuidv7');

    const wsId = uuidv7();
    getDb().insert(workspaces).values({
      id: wsId, name: 'Ws', slug: `ws-${Date.now()}`, cwd: '/tmp/ws2', isGit: false,
    }).run();
    const executor = q.getOrCreateDefaultExecutor('claude_code');
    const done = q.createExecutionWithChat({ workspaceId: wsId, agentId: executor.id, label: 'Only archived' });
    q.archiveChatSession(done.session.id);
    q.archiveExecution(done.execution.id);

    expect(q.listWorkspaceExecutions(wsId)).toHaveLength(0);
    const all = q.listWorkspaceExecutions(wsId, { includeArchived: true });
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(done.session.id);
  });

  it('prefers an execution’s active chat over its archived siblings', async () => {
    // With the status filter widened, the newest-chat subquery can now see
    // archived siblings. Ordering is by recency, so a chat archived after the
    // live one was created must not become the row the launcher shows.
    const q = await setup();
    const { getDb } = await import('@/lib/db');
    const { workspaces } = await import('@/lib/db/schema');
    const { uuidv7 } = await import('uuidv7');

    const wsId = uuidv7();
    getDb().insert(workspaces).values({
      id: wsId, name: 'Ws', slug: `ws-${Date.now()}`, cwd: '/tmp/ws3', isGit: false,
    }).run();
    const executor = q.getOrCreateDefaultExecutor('claude_code');
    const first = q.createExecutionWithChat({ workspaceId: wsId, agentId: executor.id, label: 'Shared execution' });

    const sibling = q.createChatSession({
      type: 'execution', agentId: executor.id, label: 'Newer chat', status: 'active',
    });
    q.updateChatSession(sibling.id, {
      executionId: first.execution.id,
      workspaceId: wsId,
      lastOutcomeEventAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const all = q.listWorkspaceExecutions(wsId, { includeArchived: true });
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(sibling.id);
    expect(all[0].status).toBe('active');
  });
});
