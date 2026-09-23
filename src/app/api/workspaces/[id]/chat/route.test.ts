import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Main chats (docs/agents-view-spec.md Phase 5): each agent's main chat
 * (`/api/workspaces/:id/chat/*`) and the app's (`/api/orchestrator-chat/*`)
 * share one helper and never see each other's chats. Real database. The
 * harness process and the model catalog are stubbed.
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-main-chat-'));
const TEST_DB = path.join(ROOT, 'data.db');
const saved = { root: process.env.RI_ROOT, db: process.env.RI_DB_PATH };
process.env.RI_ROOT = ROOT;

const close = vi.fn<(id: string) => Promise<void>>(async () => {});
vi.mock('@/lib/executor/adapter', () => ({ close: (id: string) => close(id) }));
vi.mock('@/lib/sessions/derive-label', () => ({ deriveRetrospectiveLabel: async () => {} }));
vi.mock('@/lib/harness/model-discovery', async () => {
  const { explicitHarnessSelection } = await import('@/lib/harness/options');
  return {
    resolveHarnessSelection: async (providerId: Parameters<typeof explicitHarnessSelection>[0]) =>
      explicitHarnessSelection(providerId, {}),
  };
});

afterAll(() => {
  for (const [key, value] of [['RI_ROOT', saved.root], ['RI_DB_PATH', saved.db]] as const) {
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
  close.mockClear();
});

type SessionBody = { session: { id: string; type: string; workspaceId: string | null; status: string; harness: string } };
type HistoryBody = { sessions: Array<{ id: string; status: string; snippet: string | null }> };

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown = {}) =>
  new Request('http://127.0.0.1/x', { method: 'POST', body: JSON.stringify(body) }) as never;

async function agentChat(id: string) {
  const { GET } = await import('./route');
  return GET(new Request('http://127.0.0.1/x') as never, ctx(id));
}
async function agentNew(id: string, body: unknown = {}) {
  const { POST } = await import('./new/route');
  return POST(post(body), ctx(id));
}
async function agentHistory(id: string) {
  const { GET } = await import('./history/route');
  return GET(new Request('http://127.0.0.1/x') as never, ctx(id));
}
async function agentResume(id: string, sessionId: unknown) {
  const { POST } = await import('./resume/route');
  return POST(post({ sessionId }), ctx(id));
}
async function appChat() {
  const { GET } = await import('@/app/api/orchestrator-chat/route');
  return GET(new Request('http://127.0.0.1/x') as never, undefined as never);
}
async function appNew() {
  const { POST } = await import('@/app/api/orchestrator-chat/route');
  return POST(new Request('http://127.0.0.1/x', { method: 'POST', body: '{}' }));
}
async function appHistory() {
  const { GET } = await import('@/app/api/orchestrator-chat/history/route');
  return GET(new Request('http://127.0.0.1/x') as never, undefined as never);
}
async function appResume(sessionId: string) {
  const { POST } = await import('@/app/api/orchestrator-chat/resume/route');
  return POST(post({ sessionId }));
}

async function seedAgent(name = 'ri') {
  const q = await import('@/lib/db/queries');
  return q.createWorkspace({ name, cwd: ROOT, isGit: false, filesToCopy: [], status: 'active' });
}

describe('GET /api/workspaces/:id/chat', () => {
  it("creates the agent's main chat once, scoped to the agent, then keeps returning it", async () => {
    const ws = await seedAgent();
    const first = (await (await agentChat(ws.id)).json()) as SessionBody;
    expect(first.session).toMatchObject({ type: 'orchestration', workspaceId: ws.id, status: 'active' });
    const again = (await (await agentChat(ws.id)).json()) as SessionBody;
    expect(again.session.id).toBe(first.session.id);
  });

  it('uses the default harness', async () => {
    const ws = await seedAgent();
    const q = await import('@/lib/db/queries');
    q.updateUserState({ defaultHarness: 'codex' });
    const body = (await (await agentChat(ws.id)).json()) as SessionBody;
    expect(body.session.harness).toBe('codex');
  });

  it('shares one create between concurrent opens', async () => {
    const ws = await seedAgent();
    const bodies = (await Promise.all([agentChat(ws.id), agentChat(ws.id), agentChat(ws.id)].map(async (r) =>
      (await (await r).json()) as SessionBody,
    )));
    expect(new Set(bodies.map((b) => b.session.id)).size).toBe(1);
    const q = await import('@/lib/db/queries');
    expect(q.listMainChats(ws.id)).toHaveLength(1);
  });

  it('gives each agent its own chat', async () => {
    const a = await seedAgent('a');
    const b = await seedAgent('b');
    const chatA = (await (await agentChat(a.id)).json()) as SessionBody;
    const chatB = (await (await agentChat(b.id)).json()) as SessionBody;
    expect(chatA.session.id).not.toBe(chatB.session.id);
    expect(chatB.session.workspaceId).toBe(b.id);
  });

  it('404s an unknown agent', async () => {
    expect((await agentChat('nope')).status).toBe(404);
  });

  it('returns an archived agent\'s current chat but never starts one', async () => {
    const q = await import('@/lib/db/queries');
    const withChat = await seedAgent('with');
    const existing = (await (await agentChat(withChat.id)).json()) as SessionBody;
    q.archiveWorkspace(withChat.id);
    expect(((await (await agentChat(withChat.id)).json()) as SessionBody).session.id).toBe(existing.session.id);
    expect((await agentNew(withChat.id)).status).toBe(409);

    const without = await seedAgent('without');
    q.archiveWorkspace(without.id);
    expect((await agentChat(without.id)).status).toBe(409);
    expect((await agentHistory(without.id)).status).toBe(200);
  });
});

describe("the app's main chat and agents' main chats stay apart", () => {
  it('neither GET returns the other', async () => {
    const ws = await seedAgent();
    const agent = (await (await agentChat(ws.id)).json()) as SessionBody;
    const app = (await (await appChat()).json()) as SessionBody;
    expect(app.session.id).not.toBe(agent.session.id);
    expect(app.session.workspaceId).toBeNull();
    expect(((await (await agentChat(ws.id)).json()) as SessionBody).session.id).toBe(agent.session.id);
  });

  it("an agent's main chat existing first does not become the app's main chat", async () => {
    const ws = await seedAgent();
    await agentChat(ws.id);
    const app = (await (await appChat()).json()) as SessionBody;
    expect(app.session.workspaceId).toBeNull();
  });

  it('new chat in one scope leaves the other current', async () => {
    const ws = await seedAgent();
    const agent = (await (await agentChat(ws.id)).json()) as SessionBody;
    const app = (await (await appChat()).json()) as SessionBody;
    await appNew();
    expect(((await (await agentChat(ws.id)).json()) as SessionBody).session.id).toBe(agent.session.id);
    await agentNew(ws.id);
    const q = await import('@/lib/db/queries');
    expect(q.getChatSession(app.session.id)?.status).toBe('archived');
    expect(close).toHaveBeenCalledWith(agent.session.id);
  });

  it('histories list only their own scope, and never scheduled fires', async () => {
    const ws = await seedAgent();
    const q = await import('@/lib/db/queries');
    const agent = (await (await agentChat(ws.id)).json()) as SessionBody;
    const app = (await (await appChat()).json()) as SessionBody;
    const fired = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' });
    const run = q.createRun({ harness: 'claude', chatSessionId: fired.id, triggerKind: 'manual', status: 'completed' });
    q.updateChatSession(fired.id, { createdByRunId: run.id });

    const appIds = ((await (await appHistory()).json()) as HistoryBody).sessions.map((s) => s.id);
    expect(appIds).toEqual([app.session.id]);
    const agentIds = ((await (await agentHistory(ws.id)).json()) as HistoryBody).sessions.map((s) => s.id);
    expect(agentIds).toEqual([agent.session.id]);
  });

  it("a scheduled fire is never taken for the app's current chat", async () => {
    const q = await import('@/lib/db/queries');
    const fired = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' });
    const run = q.createRun({ harness: 'claude', chatSessionId: fired.id, triggerKind: 'manual', status: 'completed' });
    q.updateChatSession(fired.id, { createdByRunId: run.id });
    const app = (await (await appChat()).json()) as SessionBody;
    expect(app.session.id).not.toBe(fired.id);
  });
});

describe('new chat, history and resume for an agent', () => {
  it('new chat retires the current one and history shows both, newest first', async () => {
    const ws = await seedAgent();
    const q = await import('@/lib/db/queries');
    const first = (await (await agentChat(ws.id)).json()) as SessionBody;
    q.insertChatEvent({ sessionId: first.session.id, role: 'user', source: 'user', content: '  What is   running? ' });
    const second = (await (await agentNew(ws.id, { providerId: 'codex' })).json()) as SessionBody;

    expect(second.session).toMatchObject({ workspaceId: ws.id, harness: 'codex', status: 'active' });
    expect(q.getChatSession(first.session.id)?.status).toBe('archived');
    expect(close).toHaveBeenCalledWith(first.session.id);

    const history = ((await (await agentHistory(ws.id)).json()) as HistoryBody).sessions;
    expect(history.map((s) => s.id)).toEqual([second.session.id, first.session.id]);
    expect(history[1]).toMatchObject({ status: 'archived', snippet: 'What is running?' });
  });

  it('resume brings a past chat back and retires the current one', async () => {
    const ws = await seedAgent();
    const q = await import('@/lib/db/queries');
    const first = (await (await agentChat(ws.id)).json()) as SessionBody;
    const second = (await (await agentNew(ws.id)).json()) as SessionBody;

    const resumed = (await (await agentResume(ws.id, first.session.id)).json()) as SessionBody;
    expect(resumed.session).toMatchObject({ id: first.session.id, status: 'active' });
    expect(q.getChatSession(second.session.id)?.status).toBe('archived');
    expect(((await (await agentChat(ws.id)).json()) as SessionBody).session.id).toBe(first.session.id);
  });

  it('resuming the current chat is a no-op', async () => {
    const ws = await seedAgent();
    const current = (await (await agentChat(ws.id)).json()) as SessionBody;
    const res = await agentResume(ws.id, current.session.id);
    expect(res.status).toBe(200);
    expect(close).not.toHaveBeenCalled();
  });

  it("refuses to resume another scope's chat, in both directions", async () => {
    const a = await seedAgent('a');
    const b = await seedAgent('b');
    const chatA = (await (await agentChat(a.id)).json()) as SessionBody;
    const app = (await (await appChat()).json()) as SessionBody;
    const execution = (await import('@/lib/db/queries')).createExecutionWithChat({ workspaceId: a.id, harness: 'claude', label: 'x' }).session;

    expect((await agentResume(b.id, chatA.session.id)).status).toBe(404);
    expect((await agentResume(a.id, app.session.id)).status).toBe(404);
    expect((await agentResume(a.id, execution.id)).status).toBe(404);
    expect((await appResume(chatA.session.id)).status).toBe(404);
    expect(close).not.toHaveBeenCalled();
  });

  it('validates sessionId', async () => {
    const ws = await seedAgent();
    expect((await agentResume(ws.id, undefined)).status).toBe(400);
    expect((await agentResume(ws.id, 42)).status).toBe(400);
  });
});
