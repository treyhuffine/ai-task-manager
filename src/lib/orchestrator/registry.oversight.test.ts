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

const TEST_DB = path.join(os.tmpdir(), `flow-registry-oversight-test-${process.pid}.db`);
// Isolated app root so readAuthConfig/getLocalBaseUrl can never reach the
// developer's real config.json (or their running server) from a test.
let TEST_ROOT: string;
let prevRoot: string | undefined;

beforeEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  process.env.FLOW_DB_PATH = TEST_DB;
  TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-oversight-root-'));
  prevRoot = process.env.FLOW_ROOT;
  process.env.FLOW_ROOT = TEST_ROOT;
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  if (prevRoot === undefined) delete process.env.FLOW_ROOT;
  else process.env.FLOW_ROOT = prevRoot;
});

async function resetDb() {
  const { getDb, resetDb: reset } = await import('@/lib/db');
  reset();
  getDb();
}

async function findAction(name: string) {
  const m = await import('./registry');
  const a = m.actions.find((x) => x.name === name);
  if (!a) throw new Error(`action ${name} missing`);
  return a;
}

const ctx = { remote: false } as const;

async function seedExecutionSession() {
  const q = await import('@/lib/db/queries');
  const { getDb } = await import('@/lib/db');
  const { workspaces } = await import('@/lib/db/schema');
  const { uuidv7 } = await import('uuidv7');

  const wsId = uuidv7();
  getDb()
    .insert(workspaces)
    .values({ id: wsId, name: 'OversightWs', slug: `ows-${Date.now()}`, cwd: '/tmp/ows', isGit: false })
    .run();
  const agent = q.getOrCreateDefaultExecutor('claude_code');
  const { session } = q.createExecutionWithChat({
    workspaceId: wsId,
    agentId: agent.id,
    label: 'Fix the flux capacitor',
  });
  return { wsId, session };
}

describe('execution oversight actions', () => {
  it('exposes the oversight surface', async () => {
    const { actions } = await import('./registry');
    const names = actions.map((a) => a.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_executions', 'get_session_messages', 'send_session_message',
        'get_pending_input', 'answer_pending_input',
      ]),
    );
  });

  it('pending-input actions validate the session and fail cleanly without a server', async () => {
    await resetDb();
    const get = await findAction('get_pending_input');
    const answer = await findAction('answer_pending_input');

    await expect(
      (async () => get.handler(ctx, { sessionId: 'nope' } as never))(),
    ).rejects.toMatchObject({ code: 'not_found' });

    const { session } = await seedExecutionSession();
    // Live pending state is server-owned; with no config.json in the
    // isolated root, the server client refuses before any network call.
    await expect(
      (async () => get.handler(ctx, { sessionId: session.id } as never))(),
    ).rejects.toMatchObject({ code: 'unsupported' });
    await expect(
      (async () =>
        answer.handler(ctx, {
          sessionId: session.id, requestId: 'req-1', allow: true,
        } as never))(),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('list_executions returns rail rows and degrades live flags without a server', async () => {
    await resetDb();
    const { session } = await seedExecutionSession();
    const list = await findAction('list_executions');

    const result = (await list.handler(ctx, {} as never)) as {
      live: boolean;
      executions: Array<{ sessionId: string; workspace: { name: string }; running: boolean }>;
    };

    expect(result.live).toBe(false); // no config.json in the isolated root
    const row = result.executions.find((e) => e.sessionId === session.id);
    expect(row).toBeDefined();
    expect(row!.workspace.name).toBe('OversightWs');
    expect(row!.running).toBe(false);
  });

  it('list_executions derives unread the way the rail does', async () => {
    await resetDb();
    const q = await import('@/lib/db/queries');
    const list = await findAction('list_executions');

    // Unread: outcome newer than last view.
    const { session: unreadSession } = await seedExecutionSession();
    q.updateChatSession(unreadSession.id, {
      lastOutcomeEventAt: new Date().toISOString(),
      lastViewedAt: new Date(Date.now() - 600_000).toISOString(),
    });
    // Read: view newer than the outcome.
    const { session: readSession } = await seedExecutionSession();
    q.updateChatSession(readSession.id, {
      lastOutcomeEventAt: new Date(Date.now() - 600_000).toISOString(),
      lastViewedAt: new Date().toISOString(),
    });

    const result = (await list.handler(ctx, {} as never)) as {
      executions: Array<{ sessionId: string; unread: boolean }>;
    };
    const byId = new Map(result.executions.map((e) => [e.sessionId, e]));
    expect(byId.get(unreadSession.id)?.unread).toBe(true);
    expect(byId.get(readSession.id)?.unread).toBe(false);
  });

  it('get_session_messages condenses the tail, drops noise, and surfaces pending prompts', async () => {
    await resetDb();
    const { session } = await seedExecutionSession();
    const q = await import('@/lib/db/queries');

    const at = (i: number) => new Date(Date.now() - (100 - i) * 1000).toISOString();
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'Fix it please', createdAt: at(1) });
    q.insertChatEvent({ sessionId: session.id, role: 'system', source: 'system', content: 'init', createdAt: at(2) });
    q.insertChatEvent({
      sessionId: session.id, role: 'assistant', source: 'tool_call', content: null,
      toolName: 'Bash', toolInput: { command: 'pnpm test' }, createdAt: at(3),
    });
    q.insertChatEvent({
      sessionId: session.id, role: 'assistant', source: 'agent', content: 'x'.repeat(2000), createdAt: at(4),
    });
    q.insertChatEvent({
      sessionId: session.id, role: 'system', source: 'question_request', content: 'Which database?',
      toolName: 'AskUserQuestion', createdAt: at(5),
    });

    const get = await findAction('get_session_messages');
    const result = (await get.handler(ctx, { sessionId: session.id } as never)) as {
      running: boolean | null;
      awaitingInput: boolean;
      pendingDetail: { kind: string; detail: string } | null;
      messages: Array<{ kind: string; text?: string; tool?: string; input?: string }>;
    };

    expect(result.running).toBeNull(); // server unreachable → unknown
    expect(result.awaitingInput).toBe(true); // derived from the unanswered question
    expect(result.pendingDetail?.kind).toBe('question');
    expect(result.pendingDetail?.detail).toContain('Which database?');

    const kinds = result.messages.map((m) => m.kind);
    expect(kinds).not.toContain('system'); // noise dropped
    expect(kinds).toEqual(expect.arrayContaining(['user', 'tool_call', 'agent', 'question_request']));

    const toolRow = result.messages.find((m) => m.kind === 'tool_call');
    expect(toolRow?.tool).toBe('Bash');
    expect(toolRow?.input).toContain('pnpm test');

    const agentRow = result.messages.find((m) => m.kind === 'agent');
    expect(agentRow!.text!.length).toBeLessThanOrEqual(700); // truncated
  });

  it('get_session_messages reports answered prompts as not pending', async () => {
    await resetDb();
    const { session } = await seedExecutionSession();
    const q = await import('@/lib/db/queries');
    q.insertChatEvent({ sessionId: session.id, role: 'system', source: 'question_request', content: 'Pick one', createdAt: new Date(Date.now() - 2000).toISOString() });
    q.insertChatEvent({ sessionId: session.id, role: 'system', source: 'question_response', content: 'A', createdAt: new Date(Date.now() - 1000).toISOString() });

    const get = await findAction('get_session_messages');
    const result = (await get.handler(ctx, { sessionId: session.id } as never)) as {
      awaitingInput: boolean;
      pendingDetail: unknown;
    };
    expect(result.awaitingInput).toBe(false);
    expect(result.pendingDetail).toBeNull();
  });

  it('get_session_messages throws not_found for unknown sessions', async () => {
    await resetDb();
    const get = await findAction('get_session_messages');
    await expect(
      (async () => get.handler(ctx, { sessionId: 'nope' } as never))(),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('send_session_message validates target state and fails cleanly without a server', async () => {
    await resetDb();
    const send = await findAction('send_session_message');

    await expect(
      (async () => send.handler(ctx, { sessionId: 'nope', content: 'hi' } as never))(),
    ).rejects.toMatchObject({ code: 'not_found' });

    const { session } = await seedExecutionSession();
    const q = await import('@/lib/db/queries');
    q.archiveChatSession(session.id);
    await expect(
      (async () => send.handler(ctx, { sessionId: session.id, content: 'hi' } as never))(),
    ).rejects.toMatchObject({ code: 'conflict' });

    const { session: active } = await seedExecutionSession();
    // No config.json in the isolated root → the server client refuses
    // before any network call.
    await expect(
      (async () => send.handler(ctx, { sessionId: active.id, content: 'hi' } as never))(),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });
});
