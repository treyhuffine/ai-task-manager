/**
 * The team's MCP (docs/homes-spec.md §9.8, P8.2), driven by the real MCP
 * client SDK through the real proxy and route handlers: what a member's AI
 * client can find and change, as whom, how a retry after a lost response
 * stays one change, how a stale body is refused, and that the key reaches
 * nothing else and stops working when it's revoked or its member removed.
 * No model is ever called.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createTeamTestHome, preloadTeamRoutes, serveTeam, TEAM_BASE, teamPost, teamTrpc, type TeamTestHome } from '@/test/fixtures/team-home';

const ai = vi.hoisted(() => ({
  embed: vi.fn(async () => ({ embedding: new Array(1536).fill(0) })),
  harness: vi.fn(async () => { throw new Error('no model in a team'); }),
}));
vi.mock('ai', async (importOriginal) => ({ ...(await importOriginal<typeof import('ai')>()), embed: ai.embed }));
vi.mock('@/lib/harness/one-shot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/harness/one-shot')>()),
  runHarnessText: ai.harness,
  runHarnessJson: ai.harness,
}));
vi.mock('@/lib/sessions/workstream', () => ({ coordinateLifecycleChange: vi.fn(async () => {}) }));
vi.mock('@/lib/sessions/workstream-runtime', () => ({ inProcessWorkstreamRuntime: {} }));
vi.mock('@/lib/executor/status-snapshot', () => ({ listRunningSessions: () => [] }));
vi.setConfig({ testTimeout: 60_000 });

const BASE = TEAM_BASE;
const serve = serveTeam;
const post = teamPost;
const trpcFor = teamTrpc;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- results are read as loosely as an assistant reads them
type Loose = any;

/** A member's AI assistant: the MCP client SDK with the key Connect your AI made. */
async function assistant(token: string) {
  const client = new Client({ name: 'test-assistant', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/team/mcp`), {
    fetch: serve as typeof fetch,
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }));
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    // A tool the server never registered is refused at the protocol level (MCP SDK 2.x), not as a result.
    const res = await client.callTool({ name, arguments: args }).catch((error: Error & { code?: number }) => {
      if (error.code !== -32602 || !/not found/i.test(error.message)) throw error;
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    });
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    let body: { ok: boolean; result?: Loose; replayed?: boolean; error?: Loose } | null = null;
    try { body = JSON.parse(text); } catch { /* an SDK refusal is plain text */ }
    return { isError: !!res.isError, text, body };
  };
  return { client, call, close: () => client.close() };
}

let team: TeamTestHome;
let owner: { token: string; id: string };

beforeAll(preloadTeamRoutes, 120_000);

beforeEach(async () => {
  vi.stubGlobal('fetch', serveTeam);
  team = await createTeamTestHome('ri-team-mcp-');
  owner = team.owner;
  // An ambient key, as on a real host: nothing here may use it.
  process.env.OPENAI_API_KEY = 'sk-test-ambient';
  ai.embed.mockClear();
  ai.harness.mockClear();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  await team.cleanup();
});

const joinAs = (name: string) => team.joinAs(name);

/** Connect your AI, as the member does from their sign-in. */
async function connectAi(signInToken: string, name = 'Claude Code') {
  return (await trpcFor(signInToken)).team.aiClients.create.mutate({ name });
}

const key = () => crypto.randomUUID();

describe('what an AI client can see', () => {
  it('lists exactly the shared-work tools, and refuses anything else by name', async () => {
    const { token } = await connectAi(owner.token);
    const me = await assistant(token);
    const { tools } = await me.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'complete_task', 'create_note', 'create_task', 'get_area', 'get_note', 'get_session_messages', 'get_task', 'list_areas', 'list_history',
      'list_links', 'list_members', 'list_notes', 'list_published_results', 'list_tasks', 'search', 'search_sessions', 'transition_task',
      'update_note', 'update_task',
    ]);
    // Changes take a key to retry with, and describe their arguments strictly.
    const create = tools.find((t) => t.name === 'create_note')!;
    expect(create.inputSchema.required).toContain('idempotency_key');
    expect(create.inputSchema.additionalProperties).toBe(false);

    // The personal registry, administration and hidden doors are not there.
    for (const name of ['delete_task', 'delete_note', 'describe_paths', 'describe_schema', 'remove_member', 'create_area', 'delegate_work', 'report_result', 'query', 'update', 'run_sql']) {
      const res = await me.call(name, {});
      expect(res.isError, name).toBe(true);
      expect(res.text, name).toMatch(/not found/i);
    }
    await me.close();
  });

  it('finds shared work by keyword, decisions by kind, with links and the revisions an edit needs', async () => {
    const owners = await trpcFor(owner.token);
    const area = await owners.areas.create.mutate({ name: 'Billing' });
    const task = await owners.tasks.create.mutate({ title: 'Move invoices to the new provider', rawInput: 'x', areaId: area.id, body: 'Start with the export.' });
    const decision = await owners.notes.create.mutate({ title: 'Use the existing billing provider', body: 'Cheaper, and invoices already work.', kind: 'decision' });
    await owners.notes.create.mutate({ title: 'Billing notes', body: 'Ordinary invoices note.' });
    const { token } = await connectAi(owner.token);
    const me = await assistant(token);

    const found = (await me.call('search', { query: 'invoices' })).body!.result.results;
    expect(found.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining([task.id, decision.id]));
    const decisions = (await me.call('search', { query: 'invoices', kind: 'decision' })).body!.result.results;
    expect(decisions).toEqual([expect.objectContaining({ id: decision.id, type: 'note', kind: 'decision', link: `${BASE}/?view=notes&note=${decision.id}` })]);
    expect((await me.call('list_notes', { kind: 'decision' })).body!.result.notes.map((n: { id: string }) => n.id)).toEqual([decision.id]);

    const full = (await me.call('get_task', { id: task.id })).body!.result;
    expect(full).toMatchObject({ id: task.id, body: 'Start with the export.', body_revision: 0, status_changed_count: 0, area: { id: area.id, name: 'Billing' }, link: `${BASE}/?task=${task.id}` });
    expect((await me.call('list_members')).body!.result.you).toEqual({ id: owner.id, name: 'Trey', role: 'owner' });
    expect((await me.call('get_task', { id: 'missing' })).body!.error.code).toBe('not_found');
    await me.close();
  });
});

describe('the team\'s shared chats', () => {
  it('finds a shared chat by what was said in it, and reads it with who said what', async () => {
    const q = await import('@/lib/db/queries');
    const chat = q.createTeamChat('Release planning');
    q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'Should we ship the invoices export on Tuesday?', authorMemberId: owner.id, createdAt: new Date().toISOString() });
    q.insertChatEvent({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'Tuesday works: support is staffed.', createdAt: new Date().toISOString() });
    const { token } = await connectAi(owner.token);
    const me = await assistant(token);
    const found = (await me.call('search_sessions', { query: 'invoices export' })).body!.result.chats;
    expect(found).toEqual([expect.objectContaining({ session_id: chat.id, label: 'Release planning', link: `${BASE}/?view=chat&chat=${chat.id}` })]);
    const read = (await me.call('get_session_messages', { session_id: chat.id })).body!.result.messages;
    expect(read).toEqual([
      expect.objectContaining({ from: 'Trey', text: 'Should we ship the invoices export on Tuesday?' }),
      expect.objectContaining({ from: 'Team AI', text: 'Tuesday works: support is staffed.' }),
    ]);
    expect((await me.call('get_session_messages', { session_id: 'not-a-team-chat' })).body!.error.code).toBe('not_found');
    await me.close();
  });
});

describe('what an AI client changes, and as whom', () => {
  it('records a decision and edits as the member\'s agent, never as anyone the arguments name', async () => {
    const maya = await joinAs('Maya');
    const { token } = await connectAi(maya.token, 'Codex');
    const me = await assistant(token);
    const made = await me.call('create_note', {
      idempotency_key: key(), kind: 'decision', title: 'Weekly releases on Tuesday', body: 'Chosen so support is staffed the day after.',
    });
    expect(made.body).toMatchObject({ ok: true, result: { kind: 'decision', title: 'Weekly releases on Tuesday' } });
    const noteId = made.body!.result.id;

    // Identity in the arguments is refused, not obeyed.
    for (const forged of [{ actor_member_id: owner.id }, { source: 'human' }, { member_id: owner.id }]) {
      const res = await me.call('update_note', { idempotency_key: key(), id: noteId, title: 'Renamed', ...forged });
      expect(res.isError).toBe(true);
    }

    const renamed = await me.call('update_note', { idempotency_key: key(), id: noteId, title: 'Release weekly, on Tuesday' });
    expect(renamed.body!.result).toMatchObject({ title: 'Release weekly, on Tuesday', kind: 'decision' });
    const q = await import('@/lib/db/queries');
    const versions = q.listEntityVersions('note', noteId);
    expect(versions.length).toBeGreaterThanOrEqual(2);
    for (const v of versions) expect(v).toMatchObject({ source: 'ai', actorMemberId: maya.id });
    const history = (await me.call('list_history', { type: 'note', id: noteId })).body!.result.history;
    expect(history[0]).toMatchObject({ by: "Maya's agent", source: 'ai', member: { id: maya.id, name: 'Maya' } });
    await me.close();
  });

  it('keeps a team task to its shared fields and checks who it\'s assigned to', async () => {
    const { token } = await connectAi(owner.token);
    const me = await assistant(token);
    expect((await me.call('create_task', { idempotency_key: key(), title: 'x', user_context: 'private' })).isError).toBe(true);
    const unknownPerson = await me.call('create_task', { idempotency_key: key(), title: 'x', assignee_member_id: 'nobody' });
    expect(unknownPerson.body!.error.code).toBe('invalid');
    const noArea = await me.call('create_task', { idempotency_key: key(), title: 'x', area_id: 'nowhere' });
    expect(noArea.body!.error.code).toBe('not_found');
    const ok = await me.call('create_task', { idempotency_key: key(), title: 'Draft the migration plan', assignee_member_id: owner.id, hard_deadline: '2026-11-02' });
    expect(ok.body!.result).toMatchObject({ assignee: { id: owner.id, name: 'Trey' }, hard_deadline: '2026-11-02', status: 'todo' });
    await me.close();
  });

  it('refuses a stale body with the current text, and asks for the revision it edited', async () => {
    const owners = await trpcFor(owner.token);
    const note = await owners.notes.create.mutate({ title: 'Plan', body: 'v1' });
    const { token } = await connectAi(owner.token);
    const me = await assistant(token);
    const read = (await me.call('get_note', { id: note.id })).body!.result;
    // Someone else edits in the meantime.
    await owners.notes.update.mutate({ id: note.id, patch: { body: 'v2 from the app' }, expectedBodyRevision: read.body_revision });

    const noRevision = await me.call('update_note', { idempotency_key: key(), id: note.id, body: 'mine' });
    expect(noRevision.body!.error).toMatchObject({ code: 'invalid' });
    const stale = await me.call('update_note', { idempotency_key: key(), id: note.id, body: 'mine', expected_body_revision: read.body_revision });
    expect(stale.body!.error).toMatchObject({ code: 'body_conflict', current: { body: 'v2 from the app', body_revision: 1 } });
    expect((await owners.notes.get.query({ id: note.id })).body).toBe('v2 from the app');
    const merged = await me.call('update_note', { idempotency_key: key(), id: note.id, body: 'v2 from the app\n\nmine', expected_body_revision: 1 });
    expect(merged.body!.result).toMatchObject({ body: 'v2 from the app\n\nmine', body_revision: 2 });
    await me.close();
  });

  it('moves and completes a task with the lifecycle\'s own checks', async () => {
    const owners = await trpcFor(owner.token);
    const task = await owners.tasks.create.mutate({ title: 'Ship it', rawInput: 'x' });
    const { token } = await connectAi(owner.token);
    const me = await assistant(token);
    const started = await me.call('transition_task', { idempotency_key: key(), id: task.id, command: 'start', expected_status_changed_count: 0 });
    expect(started.body!.result).toMatchObject({ from_status: 'todo', to_status: 'in_progress' });
    const stale = await me.call('complete_task', { idempotency_key: key(), id: task.id, expected_status_changed_count: 0 });
    expect(stale.body!.error.code).toBe('conflict');
    const done = await me.call('complete_task', { idempotency_key: key(), id: task.id, expected_status_changed_count: 1 });
    expect(done.body!.result).toMatchObject({ to_status: 'done' });
    // The status ledger says whose agent moved it.
    const { getDb } = await import('@/lib/db');
    const { taskStatusChanges } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const ledger = getDb().select().from(taskStatusChanges).where(eq(taskStatusChanges.taskId, task.id)).all();
    expect(ledger.map((row) => [row.toStatus, row.actorSource, row.actorMemberId])).toEqual([
      ['in_progress', 'ai', owner.id],
      ['done', 'ai', owner.id],
    ]);
    await me.close();
  });
});

describe('a retry after a lost response', () => {
  it('returns the first outcome, even after a restart, and refuses the key for another request', async () => {
    const { token } = await connectAi(owner.token);
    const me = await assistant(token);
    const once = key();
    const request = { idempotency_key: once, title: 'Pick the queue library', body: 'BullMQ, for its retries.', kind: 'decision' };
    const first = await me.call('create_note', request);
    expect(first.body).toMatchObject({ ok: true });

    // The server restarts before the client hears back.
    const { resetDb } = await import('@/lib/db');
    resetDb();
    const again = await me.call('create_note', { ...request });
    expect(again.body).toMatchObject({ ok: true, replayed: true, result: { id: first.body!.result.id } });
    const q = await import('@/lib/db/queries');
    expect(q.listNotes().filter((n) => n.title === 'Pick the queue library')).toHaveLength(1);
    expect(q.listEntityVersions('note', first.body!.result.id)).toHaveLength(1);

    const changed = await me.call('create_note', { ...request, body: 'Something else' });
    expect(changed.body!.error.code).toBe('idempotency_conflict');
    // The same key on another tool, or from another member's client, is its own.
    const task = await me.call('create_task', { idempotency_key: once, title: 'Wire up the queue' });
    expect(task.body!.ok).toBe(true);
    const maya = await joinAs('Maya');
    const theirs = await assistant((await connectAi(maya.token)).token);
    expect((await theirs.call('create_note', request)).body).toMatchObject({ ok: true });
    expect((await theirs.call('create_note', request)).body!.replayed).toBe(true);
    expect(q.listNotes().filter((n) => n.title === 'Pick the queue library')).toHaveLength(2);
    await me.close();
    await theirs.close();
  });

  it('rolls back the shared change and its history if writing the receipt fails', async () => {
    const { token } = await connectAi(owner.token);
    const me = await assistant(token);
    const { getRawDb } = await import('@/lib/db');
    const q = await import('@/lib/db/queries');
    const raw = getRawDb();
    const priorVersions = raw.prepare('SELECT count(*) AS n FROM entity_versions').get();
    raw.exec("CREATE TRIGGER refuse_review_receipt BEFORE INSERT ON shared_operation_receipts BEGIN SELECT RAISE(ABORT, 'review receipt failure'); END");
    const request = { idempotency_key: key(), title: 'Atomic change', body: 'Keep me only with a receipt' };
    expect((await me.call('create_note', request)).isError).toBe(true);
    expect(q.listNotes()).toEqual([]);
    expect(raw.prepare('SELECT count(*) AS n FROM entity_versions').get()).toEqual(priorVersions);
    expect(raw.prepare('SELECT count(*) AS n FROM shared_operation_receipts').get()).toEqual({ n: 0 });
    raw.exec('DROP TRIGGER refuse_review_receipt');
    expect((await me.call('create_note', request)).body!.ok).toBe(true);
    expect(q.listNotes()).toHaveLength(1);
    await me.close();
  });

  it('records nothing for a refused change, so it can be tried again', async () => {
    const owners = await trpcFor(owner.token);
    const note = await owners.notes.create.mutate({ title: 'Plan', body: 'v1' });
    await owners.notes.update.mutate({ id: note.id, patch: { body: 'v2' }, expectedBodyRevision: 0 });
    const { token } = await connectAi(owner.token);
    const me = await assistant(token);
    const k = key();
    expect((await me.call('update_note', { idempotency_key: k, id: note.id, body: 'mine', expected_body_revision: 0 })).body!.error.code).toBe('body_conflict');
    // A different request under the same key is fine: nothing was recorded.
    expect((await me.call('update_note', { idempotency_key: k, id: note.id, body: 'mine', expected_body_revision: 1 })).body!.ok).toBe(true);
    await me.close();
  });

  it('replays a lifecycle command and refuses a different one under its key', async () => {
    const owners = await trpcFor(owner.token);
    const task = await owners.tasks.create.mutate({ title: 'Ship it', rawInput: 'x' });
    const { token } = await connectAi(owner.token);
    const me = await assistant(token);
    const k = key();
    const first = await me.call('transition_task', { idempotency_key: k, id: task.id, command: 'start' });
    const again = await me.call('transition_task', { idempotency_key: k, id: task.id, command: 'start' });
    expect(again.body).toMatchObject({ ok: true, replayed: true, result: first.body!.result });
    expect((await me.call('transition_task', { idempotency_key: k, id: task.id, command: 'archive' })).body!.error.code).toBe('idempotency_conflict');
    expect((await owners.tasks.get.query({ id: task.id })).statusChangedCount).toBe(1);
    await me.close();
  });
});

describe('where an AI client key reaches', () => {
  it('reaches only the MCP and the team\'s files, and a sign-in never reaches the MCP', async () => {
    const { token } = await connectAi(owner.token);
    const bearer = { authorization: `Bearer ${token}` };
    // Not the app's API, not as a browser, not uploads, not the host.
    expect((await serve(`${BASE}/api/trpc/tasks.list`, { headers: bearer })).status).toBe(403);
    expect((await serve(`${BASE}/api/trpc/team.invitations.create`, { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await serve(`${BASE}/api/attachments`, { method: 'POST', headers: bearer })).status).toBe(403);
    expect((await serve(`${BASE}/api/team/host/status`, { headers: bearer })).status).toBe(403);
    expect((await post('/api/session', {}, token)).status).toBe(401);
    // Its WebSocket admission is refused too, where a member's sign-in opens one.
    const { createWebSocketContext } = await import('@/lib/trpc/ws-auth');
    expect(() => createWebSocketContext(new Request(`${BASE}/api/trpc`, { headers: { authorization: `Bearer ${owner.token}` } }), {})).not.toThrow();
    expect(() => createWebSocketContext(new Request(`${BASE}/api/trpc`, { headers: bearer }), {})).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    // A member's sign-in is for the app, not for an assistant.
    expect((await post('/api/team/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, owner.token)).status).toBe(403);
    // GET and DELETE are told there's no stream or session.
    expect((await serve(`${BASE}/api/team/mcp`, { headers: bearer })).status).toBe(405);
  });

  it('ignores forged identity headers on anonymous, sign-in and AI client requests', async () => {
    const { token, client } = await connectAi(owner.token);
    const headers = {
      'x-ri-api-key-id': client.keyId, 'x-ri-member-id': owner.id,
      'x-ri-api-key-scope': 'ai_client', 'x-ri-member-role': 'owner',
      'x-ri-caller-location': 'home', 'x-ri-team-ai-turn': 'forged-turn',
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
    };
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect((await serve(`${BASE}/api/team/mcp`, { method: 'POST', headers, body })).status).toBe(401);
    expect((await serve(`${BASE}/api/team/mcp`, { method: 'POST', headers: { ...headers, authorization: `Bearer ${owner.token}` }, body })).status).toBe(403);
    for (const path of ['/api/trpc/team.ai.status', '/api/space', '/api/team/host/status']) {
      expect((await serve(`${BASE}${path}`, { headers: { ...headers, 'x-ri-api-key-scope': 'host', authorization: `Bearer ${token}` } })).status).toBe(403);
    }
  });

  it('reads the files the team\'s records link to with its own key', async () => {
    const owners = await trpcFor(owner.token);
    const form = new FormData();
    form.append('file', new Blob(['quarterly numbers'], { type: 'text/plain' }), 'numbers.txt');
    const uploaded = await serve(`${BASE}/api/attachments`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}` }, body: form });
    const file = (await uploaded.json()) as { fileName: string; originalName: string; mimeType: string; size: number; uploadedAt: string };
    const note = await owners.notes.create.mutate({ title: 'Numbers', body: `See [[file:${file.fileName}]]`, attachments: [file] });
    const { token } = await connectAi(owner.token);
    const me = await assistant(token);
    const [attachment] = (await me.call('get_note', { id: note.id })).body!.result.attachments;
    expect(attachment).toMatchObject({ name: 'numbers.txt', url: `${BASE}/api/attachments/${file.fileName}` });
    const fetched = await serve(attachment.url, { headers: { authorization: `Bearer ${token}` } });
    expect(fetched.status).toBe(200);
    expect(await fetched.text()).toBe('quarterly numbers');
    await me.close();
  });

  it('gives an owner\'s AI client no more than a member\'s: shared work only', async () => {
    const { token } = await connectAi(owner.token);
    const me = await assistant(token);
    const { tools } = await me.client.listTools();
    expect(tools.some((t) => /member|invit|address|host|delete/.test(t.name) && t.name !== 'list_members')).toBe(false);
    await me.close();
  });
});

describe('when an AI client stops working', () => {
  it('stops at its next call when disconnected, even on a client already connected, files included', async () => {
    const owners = await trpcFor(owner.token);
    await owners.notes.create.mutate({ title: 'Plan', body: 'v1' });
    const { client, token } = await connectAi(owner.token);
    const other = await connectAi(owner.token, 'Codex');
    const me = await assistant(token);
    expect((await me.call('list_notes')).body!.ok).toBe(true);
    expect((await owners.team.aiClients.list.query()).map((c) => c.name).sort()).toEqual(['Claude Code', 'Codex']);
    // Listed apart from sign-ins, and a sign-in's sign out can't touch it.
    expect((await owners.team.signIns.list.query()).some((s) => s.keyId === client.keyId)).toBe(false);
    await expect(owners.team.signIns.revoke.mutate({ keyId: client.keyId })).rejects.toBeTruthy();

    await owners.team.aiClients.revoke.mutate({ keyId: client.keyId });
    await expect(me.call('list_notes')).rejects.toThrow();
    expect((await serve(`${BASE}/api/attachments/x.txt`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    // The other client goes on.
    const still = await assistant(other.token);
    expect((await still.call('list_notes')).body!.ok).toBe(true);
    await still.close();
  });

  it('stops for every client of a member who is removed', async () => {
    const maya = await joinAs('Maya');
    const { token } = await connectAi(maya.token);
    const me = await assistant(token);
    expect((await me.call('list_tasks')).body!.ok).toBe(true);
    await (await trpcFor(owner.token)).team.removeMember.mutate({ id: maya.id });
    await expect(me.call('list_tasks')).rejects.toThrow();
    const q = await import('@/lib/db/queries');
    expect(q.listMemberAiClients(maya.id)).toEqual([]);
  });

  it('only lets a member disconnect their own clients', async () => {
    const maya = await joinAs('Maya');
    const theirs = await connectAi(maya.token);
    await expect((await trpcFor(owner.token)).team.aiClients.revoke.mutate({ keyId: theirs.client.keyId })).rejects.toBeTruthy();
    const me = await assistant(theirs.token);
    expect((await me.call('list_tasks')).body!.ok).toBe(true);
    await me.close();
  });
});

it('makes no model call while serving every tool, with AI off and an ambient key present', async () => {
  const owners = await trpcFor(owner.token);
  const task = await owners.tasks.create.mutate({ title: 'Ship it', rawInput: 'x' });
  const { token } = await connectAi(owner.token);
  const me = await assistant(token);
  const note = (await me.call('create_note', { idempotency_key: key(), body: 'Decided to ship Friday', kind: 'decision' })).body!.result;
  for (const [name, args] of [
    ['search', { query: 'ship' }], ['search', { query: 'ship', kind: 'decision' }], ['list_tasks', {}], ['get_task', { id: task.id }],
    ['list_notes', {}], ['get_note', { id: note.id }], ['list_areas', {}], ['list_members', {}], ['list_links', { type: 'note', id: note.id }],
    ['list_history', { type: 'task', id: task.id }], ['list_published_results', { task_id: task.id }],
    ['update_task', { idempotency_key: key(), id: task.id, title: 'Ship it Friday' }],
    ['transition_task', { idempotency_key: key(), id: task.id, command: 'start' }],
    ['complete_task', { idempotency_key: key(), id: task.id }],
    ['update_note', { idempotency_key: key(), id: note.id, kind: 'note' }],
  ] as const) {
    expect((await me.call(name, args as Record<string, unknown>)).body!.ok, name).toBe(true);
  }
  expect(ai.embed).not.toHaveBeenCalled();
  expect(ai.harness).not.toHaveBeenCalled();
  await me.close();
});
