import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The orchestrator actions an agent's main chat (and the app's main chat) use
 * to manage work (docs/agents-view-spec.md Phase 4): delegation,
 * archive_execution, update_workspace, and authenticated message
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

describe('the registry surface', () => {
  it('exposes the new actions on both CLI and MCP', async () => {
    const { actions } = await import('./registry');
    expect(actions.map((a) => a.name)).toEqual(
      expect.arrayContaining(['message_agent', 'delegate_work', 'archive_execution', 'update_workspace']),
    );
    for (const removed of ['start_execution', 'send_session_message', 'ask_agent', 'send_agent_message', 'submit_memory_finding']) {
      expect(actions.map(a => a.name)).not.toContain(removed);
      expect(await run(removed, {})).toMatchObject({ ok: false, error: { code: 'unknown_action' } });
    }
  });
});

describe('durable coordination approval surface', () => {
  it('records a delegation before approval without creating a target chat', async () => {
    const { q, ws, agentChat } = await seed();
    const before = q.listChatSessions({ workspaceId: ws.id }).length;
    const result = await run('delegate_work', { workspace_id: ws.id, request_id: 'approved-launch', prompt: 'Implement the fix.', provider: 'claude', permission_mode: 'plan' }, { remote: true, actor: { source: 'ai', sessionId: agentChat.id } });
    expect(result).toMatchObject({ ok: true, result: { status: 'awaiting_approval', response_required: true } });
    await (await import('@/lib/coordination/service')).drainAgentCoordination();
    expect(q.listChatSessions({ workspaceId: ws.id })).toHaveLength(before);
    expect(q.pendingAgentApprovals(agentChat.id)).toHaveLength(1);
    expect(serverFetch).not.toHaveBeenCalled();
  });
  it('keeps coordination preferences and Hold out of agent-facing generic update parameters', async () => {
    for (const name of ['update_workspace', 'update_user_state']) {
      const definition = await action(name);
      for (const key of ['agentCoordinationPolicy', 'agent_coordination_policy', 'coordinationHeldAt', 'coordination_held_at']) expect(definition.params).not.toHaveProperty(key);
    }
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

  it('names the files that would be lost when the worktree is dirty, and points at force', async () => {
    const { execution } = await seed();
    const { ServerResponseError } = await import('./server-client');
    serverFetch.mockRejectedValueOnce(new ServerResponseError(
      409,
      JSON.stringify({
        error: 'DirtyWorktreeError',
        code: 'dirty_worktree',
        message: 'Workspace has uncommitted or unpushed work: 1 untracked, 1 modified',
        label: 'Fix login',
        files: [
          { path: 'notes.md', change: 'untracked' },
          { path: 'src/login.ts', change: 'changed' },
        ],
        omitted: 3,
      }),
      'POST → 409',
    ));
    const envelope = await run('archive_execution', { sessionId: execution.id });
    expect(envelope).toMatchObject({ ok: false, error: { code: 'conflict' } });
    const error = (envelope as { error: { message: string; suggestion: string } }).error;
    expect(error.message).toContain('not committed');
    expect(error.message).toContain('notes.md (untracked), src/login.ts (changed) and 3 more');
    expect(error.suggestion).toContain('force: true');
  });

  it('falls back to the server message from a device too old to list the files', async () => {
    const { execution } = await seed();
    const { ServerResponseError } = await import('./server-client');
    serverFetch.mockRejectedValueOnce(new ServerResponseError(
      409,
      JSON.stringify({ error: 'DirtyWorktreeError', code: 'dirty_worktree', message: '2 uncommitted files', label: null, files: null, omitted: 0 }),
      'POST → 409',
    ));
    const envelope = await run('archive_execution', { sessionId: execution.id });
    const error = (envelope as { error: { message: string } }).error;
    expect(error.message).toContain('2 uncommitted files');
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

  it('keeps integration access and the browser out of reach over MCP', async () => {
    const { ws } = await seed();
    for (const change of [{ integrationScopes: [{ toolkitId: 'gmail' }] }, { browserEnabled: true }]) {
      const envelope = await run('update_workspace', { id: ws.id, ...change }, { remote: true });
      expect(envelope).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    }
    // Unknown transport gets the remote rule too.
    expect(await run('update_workspace', { id: ws.id, browserEnabled: false }, {})).toMatchObject({ ok: false });
    expect(serverFetch).not.toHaveBeenCalled();
  });

  it('lets the local CLI change integration access through the validating route', async () => {
    const { ws } = await seed();
    serverFetch.mockResolvedValue({});
    const envelope = await run('update_workspace', { id: ws.id, integrationScopes: [{ toolkitId: 'github' }] }, { remote: false });
    expect(envelope.ok).toBe(true);
    expect(serverFetch).toHaveBeenCalledWith(`/workspaces/${ws.id}/integration-scopes`, expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ scopes: [{ toolkitId: 'github' }] }),
    }));
  });

  it('forwards an account list per service, folding the legacy single `account` into it', async () => {
    const { ws } = await seed();
    serverFetch.mockResolvedValue({});
    const envelope = await run('update_workspace', {
      id: ws.id,
      integrationScopes: [
        { toolkitId: 'gmail', accounts: ['work@gmail.com', { accountId: 'sub-side', authConfigId: 'cfg-team' }] },
        { toolkitId: 'google_calendar', account: 'personal@gmail.com' },
        { toolkitId: 'slack', accounts: [], account: null },
      ],
    }, { remote: false });
    expect(envelope.ok).toBe(true);
    expect(serverFetch).toHaveBeenCalledWith(`/workspaces/${ws.id}/integration-scopes`, expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        scopes: [
          { toolkitId: 'gmail', accounts: ['work@gmail.com', { accountId: 'sub-side', authConfigId: 'cfg-team' }] },
          { toolkitId: 'google_calendar', accounts: ['personal@gmail.com'] },
          { toolkitId: 'slack' },
        ],
      }),
    }));
  });

  it('turns an account that matches no connected account into invalid_params', async () => {
    const { ws } = await seed();
    const { ServerResponseError } = await import('./server-client');
    const message = 'no connected Gmail account matches "nobody@gmail.com". Connected: "work@gmail.com"';
    serverFetch.mockRejectedValueOnce(new ServerResponseError(400, JSON.stringify({ error: message }), 'PUT → 400'));
    expect(await run('update_workspace', {
      id: ws.id,
      integrationScopes: [{ toolkitId: 'gmail', accounts: ['nobody@gmail.com'] }],
    }, { remote: false })).toMatchObject({ ok: false, error: { code: 'invalid_params', message } });
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
