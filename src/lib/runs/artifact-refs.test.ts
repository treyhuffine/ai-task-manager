/**
 * What-a-run-changed, recorded at the action layer. See artifact-refs.ts for
 * why the old stream-parsing path never recorded anything.
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
  abort: vi.fn(async () => {}),
  ExecutorError: class extends Error {},
}));

vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

const TEST_DB = path.join(os.tmpdir(), `ri-artifact-refs-test-${process.pid}.db`);

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

/** A chat with a run in flight, as a trigger fire leaves it mid-turn. */
async function chatWithActiveRun() {
  const queries = await import('@/lib/db/queries');
  const chat = queries.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' });
  const run = queries.createRun({
    harness: 'claude', triggerKind: 'manual', status: 'running', chatSessionId: chat.id,
  });
  return { chat, run };
}

describe('ACTION_ARTIFACT_REFS', () => {
  it('only names real, mutating orchestrator actions', async () => {
    const { ACTION_ARTIFACT_REFS } = await import('./artifact-refs');
    const { actions } = await import('@/lib/orchestrator/registry');
    for (const name of Object.keys(ACTION_ARTIFACT_REFS)) {
      const action = actions.find((a) => a.name === name);
      expect(action, name).toBeDefined();
      expect(action?.mutating, name).toBe(true);
    }
  });

  it('reads creates from the result, updates and lifecycle commands from the input', async () => {
    const { artifactRefsForAction } = await import('./artifact-refs');
    expect(artifactRefsForAction('create_task', { title: 'x' }, { id: 't1' })).toEqual([{ kind: 'task', id: 't1' }]);
    expect(artifactRefsForAction('update_task', { id: 't2' }, {})).toEqual([{ kind: 'task', id: 't2' }]);
    expect(artifactRefsForAction('transition_task', { id: 't3', command: 'archive' }, {})).toEqual([{ kind: 'task', id: 't3' }]);
    expect(artifactRefsForAction('create_note', {}, { id: 'n1' })).toEqual([{ kind: 'note', id: 'n1' }]);
    expect(artifactRefsForAction('reorder_tasks', {}, { changedTaskIds: ['a', 'b'] })).toEqual([
      { kind: 'task', id: 'a' },
      { kind: 'task', id: 'b' },
    ]);
    expect(artifactRefsForAction('create_area', { name: 'x' }, { id: 'a1' })).toEqual([]);
    expect(artifactRefsForAction('create_task', {}, null)).toEqual([]);
  });
});

describe('recording through runAction', () => {
  it('records a mutating action from a chat with a run in flight, deduped across calls', async () => {
    const queries = await import('@/lib/db/queries');
    const { runAction } = await import('@/lib/orchestrator/dispatch');
    const { chat, run } = await chatWithActiveRun();
    const actor = { source: 'ai' as const, sessionId: chat.id };

    const created = await runAction('create_note', { title: 'From the agent', body: 'x' }, { remote: true, actor });
    const noteId = (created.result as { id: string }).id;
    const task = queries.createTask({ title: 'T' });
    await runAction('update_task', { id: task.id, description: 'one' }, { remote: true, actor });
    await runAction('update_task', { id: task.id, description: 'two' }, { remote: true, actor });

    expect(queries.getRun(run.id)!.artifactRefs).toEqual([
      { kind: 'note', id: noteId },
      { kind: 'task', id: task.id },
    ]);
  });

  it('ignores reads, failed actions, callers with no chat, and chats with no run in flight', async () => {
    const queries = await import('@/lib/db/queries');
    const { runAction } = await import('@/lib/orchestrator/dispatch');
    const { chat, run } = await chatWithActiveRun();
    const task = queries.createTask({ title: 'T' });

    await runAction('get_task', { id: task.id }, { remote: true, actor: { source: 'ai', sessionId: chat.id } });
    await runAction('update_task', { id: 'missing' }, { remote: true, actor: { source: 'ai', sessionId: chat.id } });
    // A human in the app or at the CLI: no calling chat.
    await runAction('update_task', { id: task.id, description: 'human' }, { remote: false });
    // A chat with no run in flight (a manual chat send).
    const idle = queries.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' });
    await runAction('update_task', { id: task.id, description: 'idle chat' }, { remote: true, actor: { source: 'ai', sessionId: idle.id } });

    expect(queries.getRun(run.id)!.artifactRefs ?? []).toEqual([]);
  });

  it('attributes to the run in flight, not a finished one in the same chat', async () => {
    const queries = await import('@/lib/db/queries');
    const { runAction } = await import('@/lib/orchestrator/dispatch');
    const chat = queries.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' });
    const done = queries.createRun({ harness: 'claude', triggerKind: 'manual', status: 'completed', chatSessionId: chat.id });
    const live = queries.createRun({ harness: 'claude', triggerKind: 'manual', status: 'running', chatSessionId: chat.id });
    const task = queries.createTask({ title: 'T' });
    await runAction('update_task', { id: task.id, description: 'x' }, { remote: true, actor: { source: 'ai', sessionId: chat.id } });
    expect(queries.getRun(done.id)!.artifactRefs ?? []).toEqual([]);
    expect(queries.getRun(live.id)!.artifactRefs).toEqual([{ kind: 'task', id: task.id }]);
  });
});

describe('appendRunArtifactRefs', () => {
  it('merges and dedupes by kind and id, keeping first-seen order', async () => {
    const queries = await import('@/lib/db/queries');
    const { run } = await chatWithActiveRun();
    queries.appendRunArtifactRefs(run.id, [{ kind: 'task', id: 'a' }, { kind: 'note', id: 'a' }]);
    const merged = queries.appendRunArtifactRefs(run.id, [{ kind: 'task', id: 'a' }, { kind: 'task', id: 'b' }]);
    expect(merged).toEqual([
      { kind: 'task', id: 'a' },
      { kind: 'note', id: 'a' },
      { kind: 'task', id: 'b' },
    ]);
    expect(queries.appendRunArtifactRefs('no-such-run', [{ kind: 'task', id: 'x' }])).toBeNull();
  });
});
