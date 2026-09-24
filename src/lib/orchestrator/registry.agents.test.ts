import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The orchestrator actions an agent's main chat (and the app's main chat) use
 * to manage work (docs/agents-view-spec.md Phase 4): start_execution,
 * archive_execution, update_workspace, and send_session_message's
 * provenance. The app server is mocked and every call recorded; the database
 * and the credentials are real.
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-registry-agents-'));
const TOKEN = 'tok_registry_agents';
const saved = { root: process.env.RI_ROOT, db: process.env.RI_DB_PATH, config: process.env.RI_CONFIG_DIR };
process.env.RI_ROOT = ROOT;
process.env.RI_CONFIG_DIR = path.join(ROOT, '.config');
fs.mkdirSync(process.env.RI_CONFIG_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.RI_CONFIG_DIR, 'config.json'), JSON.stringify({ version: 1, localToken: TOKEN }));

const serverFetch = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
vi.mock('./server-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./server-client')>();
  return {
    ...actual,
    serverFetch: (p: string, init?: RequestInit) => serverFetch(p, init),
    fetchLiveSignals: async () => null,
  };
});

const TEST_DB = path.join(ROOT, 'data.db');

afterAll(() => {
  for (const [key, value] of [['RI_ROOT', saved.root], ['RI_DB_PATH', saved.db], ['RI_CONFIG_DIR', saved.config]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + suffix, { force: true });
  process.env.RI_DB_PATH = TEST_DB;
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
  serverFetch.mockReset();
});

async function action(name: string) {
  const { actions } = await import('./registry');
  const found = actions.find((a) => a.name === name);
  if (!found) throw new Error(`action ${name} missing`);
  return found;
}

async function run(name: string, input: Record<string, unknown>, ctx: Record<string, unknown> = { remote: true }) {
  const { runAction } = await import('./dispatch');
  return runAction(name, input, ctx as never);
}

async function seed() {
  const q = await import('@/lib/db/queries');
  const ws = q.createWorkspace({ name: 'ri', cwd: ROOT, isGit: false, filesToCopy: [], status: 'active' });
  const { session: execution } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Refactor auth' });
  const agentChat = q.createChatSession({ type: 'orchestration', workspaceId: ws.id, harness: 'claude', status: 'active' });
  return { q, ws, execution, agentChat };
}

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.[name];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('the registry surface', () => {
  it('exposes the new actions on both CLI and MCP', async () => {
    const { actions } = await import('./registry');
    expect(actions.map((a) => a.name)).toEqual(
      expect.arrayContaining(['start_execution', 'archive_execution', 'update_workspace']),
    );
  });
});

describe('send_session_message provenance', () => {
  it('signs the message with the calling chat, so the route can record the sender', async () => {
    const { execution, agentChat } = await seed();
    serverFetch.mockResolvedValue({ id: 'evt-1' });
    const envelope = await run('send_session_message', { sessionId: execution.id, content: 'Fix the test' }, {
      remote: true,
      actor: { source: 'ai', sessionId: agentChat.id },
    });
    expect(envelope).toMatchObject({ ok: true, result: { delivered: true, sentFrom: agentChat.id } });
    const [p, init] = serverFetch.mock.calls[0];
    expect(p).toBe(`/sessions/${execution.id}/messages`);
    const { verifySessionCredential } = await import('./session-credential');
    expect(verifySessionCredential(headerOf(init, 'x-ri-session'), TOKEN)).toBe(agentChat.id);
  });

  it('sends unsigned for a human at the CLI', async () => {
    const { execution } = await seed();
    serverFetch.mockResolvedValue({ id: 'evt-1' });
    await run('send_session_message', { sessionId: execution.id, content: 'hi' }, { remote: false });
    expect(headerOf(serverFetch.mock.calls[0][1], 'x-ri-session')).toBeUndefined();
  });

  it('refuses a chat messaging itself', async () => {
    const { execution } = await seed();
    const envelope = await run('send_session_message', { sessionId: execution.id, content: 'hi' }, {
      remote: true,
      actor: { source: 'ai', sessionId: execution.id },
    });
    expect(envelope).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    expect(serverFetch).not.toHaveBeenCalled();
  });
});

describe('start_execution', () => {
  it('creates the execution, then sends the prompt, both under ids derived from requestId', async () => {
    const { ws, agentChat } = await seed();
    serverFetch.mockImplementation(async (p) =>
      p.endsWith('/sessions') ? { id: 'created', executionId: 'exec-new' } : { id: 'evt' },
    );
    const envelope = await run('start_execution', {
      workspaceId: ws.id,
      prompt: 'Add rate limiting to the login route',
      requestId: 'rate-limit-1',
      provider: 'codex',
      label: 'Rate limiting',
    }, { remote: true, actor: { source: 'ai', sessionId: agentChat.id } });
    expect(envelope).toMatchObject({ ok: true, result: { started: true, executionId: 'exec-new' } });

    const [createPath, createInit] = serverFetch.mock.calls[0];
    expect(createPath).toBe(`/workspaces/${ws.id}/sessions`);
    const createBody = JSON.parse(createInit!.body as string);
    expect(createBody).toMatchObject({ harness: 'codex', label: 'Rate limiting' });
    expect(createBody.sessionId).toMatch(UUID);

    const [sendPath, sendInit] = serverFetch.mock.calls[1];
    expect(sendPath).toBe('/sessions/created/messages');
    const sendBody = JSON.parse(sendInit!.body as string);
    expect(sendBody.content).toBe('Add rate limiting to the login route');
    expect(sendBody.id).toMatch(UUID);
    const { verifySessionCredential } = await import('./session-credential');
    expect(verifySessionCredential(headerOf(sendInit, 'x-ri-session'), TOKEN)).toBe(agentChat.id);
  });

  it('returns the same execution on retry instead of starting a second', async () => {
    const { q, ws } = await seed();
    serverFetch.mockImplementation(async (p) => (p.endsWith('/sessions') ? { id: 'x', executionId: 'e' } : { id: 'evt' }));
    await run('start_execution', { workspaceId: ws.id, prompt: 'Do it', requestId: 'job-7' });
    const first = JSON.parse(serverFetch.mock.calls[0][1]!.body as string);
    const firstPrompt = JSON.parse(serverFetch.mock.calls[1][1]!.body as string);

    // The first attempt's server call created this chat under the derived id.
    q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: null, chatSessionId: first.sessionId });
    serverFetch.mockClear();

    const retry = await run('start_execution', { workspaceId: ws.id, prompt: 'Do it', requestId: 'job-7' });
    expect(retry).toMatchObject({ ok: true, result: { started: false, sessionId: first.sessionId } });
    // No second create. The prompt goes again under the same event id, which the route dedupes.
    expect(serverFetch).toHaveBeenCalledTimes(1);
    expect(serverFetch.mock.calls[0][0]).toBe(`/sessions/${first.sessionId}/messages`);
    expect(JSON.parse(serverFetch.mock.calls[0][1]!.body as string).id).toBe(firstPrompt.id);
  });

  it('scopes requestId by workspace, so two agents never collide', async () => {
    const { q, ws } = await seed();
    const other = q.createWorkspace({ name: 'bounce', cwd: ROOT, isGit: false, filesToCopy: [], status: 'active' });
    serverFetch.mockImplementation(async (p) => (p.endsWith('/sessions') ? { id: 'x', executionId: 'e' } : { id: 'evt' }));
    await run('start_execution', { workspaceId: ws.id, prompt: 'a', requestId: 'same' });
    await run('start_execution', { workspaceId: other.id, prompt: 'b', requestId: 'same' });
    const a = JSON.parse(serverFetch.mock.calls[0][1]!.body as string).sessionId;
    const b = JSON.parse(serverFetch.mock.calls[2][1]!.body as string).sessionId;
    expect(a).not.toBe(b);
  });

  it('sets the permission mode before the prompt, only when it differs', async () => {
    const { ws } = await seed();
    serverFetch.mockImplementation(async (p) => (p.endsWith('/sessions') ? { id: 'created', executionId: 'e' } : { id: 'evt' }));
    await run('start_execution', { workspaceId: ws.id, prompt: 'Plan it', requestId: 'plan-1', permissionMode: 'plan' });
    expect(serverFetch.mock.calls.map(([p, init]) => `${init?.method} ${p}`)).toEqual([
      `POST /workspaces/${ws.id}/sessions`,
      'PATCH /sessions/created',
      'POST /sessions/created/messages',
    ]);
    expect(JSON.parse(serverFetch.mock.calls[1][1]!.body as string)).toEqual({ permissionMode: 'plan' });
  });

  it('turns a refused task link into a conflict with the server\'s reason', async () => {
    const { ws } = await seed();
    const { ServerResponseError } = await import('./server-client');
    serverFetch.mockRejectedValueOnce(new ServerResponseError(
      409,
      JSON.stringify({ error: 'TaskNotStartableForDispatch', message: 'Task is done, it cannot be started.' }),
      'POST → 409',
    ));
    const envelope = await run('start_execution', { workspaceId: ws.id, prompt: 'x', requestId: 'r', taskId: 't' });
    expect(envelope).toMatchObject({ ok: false, error: { code: 'conflict', message: 'Task is done, it cannot be started.' } });
  });

  it('refuses unknown and archived workspaces without calling the server', async () => {
    const { q, ws } = await seed();
    expect(await run('start_execution', { workspaceId: 'nope', prompt: 'x', requestId: 'r' })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    q.archiveWorkspace(ws.id);
    expect(await run('start_execution', { workspaceId: ws.id, prompt: 'x', requestId: 'r' })).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    expect(serverFetch).not.toHaveBeenCalled();
  });
});

describe('archive_execution', () => {
  it('archives through the server', async () => {
    const { execution } = await seed();
    serverFetch.mockResolvedValue({});
    const envelope = await run('archive_execution', { sessionId: execution.id });
    expect(envelope).toMatchObject({ ok: true, result: { archived: true, alreadyArchived: false } });
    expect(serverFetch).toHaveBeenCalledWith(`/sessions/${execution.id}/archive`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ force: false }),
    }));
  });

  it('says what would be lost when the worktree is dirty, and points at force', async () => {
    const { execution } = await seed();
    const { ServerResponseError } = await import('./server-client');
    serverFetch.mockRejectedValueOnce(new ServerResponseError(
      409,
      JSON.stringify({ error: 'DirtyWorktreeError', code: 'dirty_worktree', message: '2 uncommitted files' }),
      'POST → 409',
    ));
    const envelope = await run('archive_execution', { sessionId: execution.id });
    expect(envelope).toMatchObject({ ok: false, error: { code: 'conflict' } });
    const error = (envelope as { error: { message: string; suggestion: string } }).error;
    expect(error.message).toContain('uncommitted or unpushed work');
    expect(error.message).toContain('2 uncommitted files');
    expect(error.suggestion).toContain('force: true');
  });

  it('is a no-op on an archived execution and refuses non-execution chats', async () => {
    const { q, execution, agentChat } = await seed();
    q.archiveExecution(execution.executionId!);
    q.archiveChatSession(execution.id);
    expect(await run('archive_execution', { sessionId: execution.id })).toMatchObject({
      ok: true,
      result: { alreadyArchived: true },
    });
    expect(await run('archive_execution', { sessionId: agentChat.id })).toMatchObject({
      ok: false,
      error: { code: 'invalid_params' },
    });
    expect(serverFetch).not.toHaveBeenCalled();
  });
});

describe('update_workspace', () => {
  it('sends plain fields through the server PATCH and returns the fresh row', async () => {
    const { ws } = await seed();
    serverFetch.mockResolvedValue({});
    const envelope = await run('update_workspace', { id: ws.id, purpose: 'Ship Ri', instructions: null });
    expect(envelope.ok).toBe(true);
    expect(serverFetch).toHaveBeenCalledWith(`/workspaces/${ws.id}`, expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ purpose: 'Ship Ri', instructions: null }),
    }));
  });

  it('keeps connector access and the browser out of reach over MCP', async () => {
    const { ws } = await seed();
    for (const change of [{ connectorScopes: [{ toolkitId: 'gmail' }] }, { browserEnabled: true }]) {
      const envelope = await run('update_workspace', { id: ws.id, ...change }, { remote: true });
      expect(envelope).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    }
    // Unknown transport gets the remote rule too.
    expect(await run('update_workspace', { id: ws.id, browserEnabled: false }, {})).toMatchObject({ ok: false });
    expect(serverFetch).not.toHaveBeenCalled();
  });

  it('lets the local CLI change connector access through the validating route', async () => {
    const { ws } = await seed();
    serverFetch.mockResolvedValue({});
    const envelope = await run('update_workspace', { id: ws.id, connectorScopes: [{ toolkitId: 'github' }] }, { remote: false });
    expect(envelope.ok).toBe(true);
    expect(serverFetch).toHaveBeenCalledWith(`/workspaces/${ws.id}/connector-scopes`, expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ scopes: [{ toolkitId: 'github' }] }),
    }));
  });

  it('passes a validation message through as invalid_params', async () => {
    const { ws } = await seed();
    const { ServerResponseError } = await import('./server-client');
    serverFetch.mockRejectedValueOnce(new ServerResponseError(
      400,
      JSON.stringify({ error: 'Purpose is 612 characters. The limit is 500.' }),
      'PATCH → 400',
    ));
    expect(await run('update_workspace', { id: ws.id, purpose: 'p'.repeat(612) })).toMatchObject({
      ok: false,
      error: { code: 'invalid_params', message: 'Purpose is 612 characters. The limit is 500.' },
    });
  });

  it('does not offer the folder, scripts or files-to-copy', async () => {
    const update = await action('update_workspace');
    for (const field of ['cwd', 'setupCommand', 'teardownCommand', 'startCommand', 'filesToCopy', 'worktreeRoot']) {
      expect(Object.keys(update.params)).not.toContain(field);
    }
  });
});

describe('workspace reads and create', () => {
  it('create_workspace stores purpose and instructions, and maps a cap error to invalid_params', async () => {
    // The home's own sessions: remote transport, host key.
    const onHome = { remote: true, caller: { location: 'home' } };
    const created = await run('create_workspace', { name: 'docs', cwd: ROOT, purpose: '  Keep the docs honest ', instructions: 'Plain English.' }, onHome);
    expect(created).toMatchObject({ ok: true, result: { purpose: 'Keep the docs honest', instructions: 'Plain English.' } });
    const tooLong = await run('create_workspace', { name: 'docs2', cwd: ROOT, purpose: 'p'.repeat(501) }, onHome);
    expect(tooLong).toMatchObject({ ok: false, error: { code: 'invalid_params', message: 'Purpose is 501 characters. The limit is 500.' } });
  });

  it('get_workspace and list_workspaces return purpose and instructions', async () => {
    const { q, ws } = await seed();
    q.updateWorkspace(ws.id, { purpose: 'Ship Ri', instructions: 'Be terse.' });
    expect(await run('get_workspace', { id: ws.id })).toMatchObject({ result: { purpose: 'Ship Ri', instructions: 'Be terse.' } });
    const list = await run('list_workspaces', {});
    expect((list as { result: Array<{ id: string; purpose: string }> }).result.find((w) => w.id === ws.id)?.purpose).toBe('Ship Ri');
  });

  it('list_workspace_sessions lists executions, not the agent\'s main chat', async () => {
    const { ws, execution } = await seed();
    const envelope = await run('list_workspace_sessions', { workspaceId: ws.id });
    expect((envelope as { result: Array<{ id: string }> }).result.map((s) => s.id)).toEqual([execution.id]);
  });
});
