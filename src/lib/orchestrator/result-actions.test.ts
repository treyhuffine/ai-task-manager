import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Exercise the authenticated server-owned write endpoint while keeping the test
// self-contained. Preserve real serverFetch non-2xx error semantics.
vi.mock('./server-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('./server-client')>();
  return { ...original, serverFetch: async (target: string, init: RequestInit = {}) => {
    const handler = target === '/results/reports'
      ? (await import('@/app/api/results/reports/route')).POST
      : target === '/results/review-reports'
        ? (await import('@/app/api/results/review-reports/route')).POST : null;
    if (!handler) throw new Error(`Unexpected result test server path: ${target}`);
    const response = await handler(new Request(`http://localhost/api${target}`, init));
    if (!response.ok) throw new original.ServerResponseError(response.status, await response.text(), `Result endpoint returned ${response.status}`);
    return response.json();
  } };
});

describe('signed handoff action surface', () => {
  let root: string;
  const saved = new Map<string, string | undefined>();
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-result-actions-'));
    for (const key of ['RI_ROOT', 'RI_DB_PATH', 'RI_MIRROR_DISABLED']) saved.set(key, process.env[key]);
    process.env.RI_ROOT = root;
    process.env.RI_DB_PATH = path.join(root, 'data.db');
    process.env.RI_MIRROR_DISABLED = '1';
    vi.resetModules();
    const { writeAuthConfig } = await import('@/lib/auth/config-file');
    writeAuthConfig({ localToken: 'result-actions-test-token' });
  });
  afterEach(async () => {
    const { resetDb } = await import('@/lib/db');
    resetDb();
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('gates discovery and rejects stale calls, but keeps reads and committed retries available', async () => {
    const { discoverableResultActions } = await import('./result-actions');
    const { runAction } = await import('./dispatch');
    const gates = await import('@/lib/work-results/capabilities');
    const q = await import('@/lib/db/queries');
    expect(discoverableResultActions()).toEqual([]);
    const session = q.createChatSession({ harness: 'claude', type: 'orchestration', userId: 'local' });
    const context = { remote: true, actor: { source: 'ai' as const, sessionId: session.id } };
    const input = { request_id: 'one', body: 'Useful research findings.' };
    expect((await runAction('report_result', input, context)).error?.code).toBe('unsupported');
    gates.setWorkResultCapabilities({ handoffsEnabled: true });
    expect(discoverableResultActions().map((action) => action.name)).toEqual(['get_handoff_context', 'report_result', 'get_result', 'list_results']);
    const created = await runAction('report_result', input, context);
    expect(created.ok).toBe(true);
    const id = (created.result as { result_id: string }).result_id;
    expect(q.listChatEvents(session.id).filter((event) => event.source === 'work_result')).toHaveLength(1);
    gates.setWorkResultCapabilities({ handoffsEnabled: false });
    expect(discoverableResultActions()).toEqual([]);
    expect((await runAction('report_result', input, context)).ok).toBe(true);
    expect((await runAction('get_result', { id }, context)).ok).toBe(true);
    expect((await runAction('report_result', { ...input, request_id: 'two' }, context)).error?.code).toBe('unsupported');
    expect((await runAction('report_result', { ...input, body: 'Changed content.' }, context)).error?.code).toBe('conflict');
    expect((await runAction('report_result', input, { remote: false })).error?.code).toBe('unsupported');
  });

  it('confines a background reviewer to its assigned result and completion action', async () => {
    const { runAction } = await import('./dispatch');
    const gates = await import('@/lib/work-results/capabilities');
    const q = await import('@/lib/db/queries');
    gates.setWorkResultCapabilities({ handoffsEnabled: true });
    const target = q.createWorkResult({ userId: 'local', source: 'human' }, { requestId: 'target', body: 'An artifact.' }).result;
    const reviewer = q.createChatSession({ harness: 'claude', type: 'execution', userId: 'local', surfaceKind: 'result_review', surfaceRef: 'assigned-review' });
    const context = { remote: true, actor: { source: 'ai' as const, sessionId: reviewer.id } };
    expect((await runAction('create_task', { title: 'Forbidden edit' }, context)).error?.code).toBe('unsupported');
    expect((await runAction('get_handoff_context', {}, context)).error?.code).toBe('unsupported');
    expect((await runAction('list_results', {}, context)).error?.code).toBe('unsupported');
    expect((await runAction('get_result', { id: target.id }, context)).error?.code).toBe('unsupported');
  });

  it('replays a committed signed report after source pruning and disable without admitting new work', async () => {
    const { runAction } = await import('./dispatch');
    const gates = await import('@/lib/work-results/capabilities');
    const { writeAuthConfig } = await import('@/lib/auth/config-file');
    const { actorFromSessionCredential, sessionCredential } = await import('./session-credential');
    const { getDb } = await import('@/lib/db');
    const { chatSessions } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const q = await import('@/lib/db/queries');
    writeAuthConfig({ localToken: 'result-retry-test-token' });
    gates.setWorkResultCapabilities({ handoffsEnabled: true });
    const session = q.createChatSession({ harness: 'claude', type: 'orchestration', userId: 'local' });
    const credential = sessionCredential(session.id)!;
    const input = { request_id: 'durable-retry', body: 'Research findings that survive the conversation.' };
    const created = await runAction('report_result', input, { remote: true, actor: actorFromSessionCredential(credential) });
    expect(created.ok).toBe(true);
    getDb().delete(chatSessions).where(eq(chatSessions.id, session.id)).run();
    gates.setWorkResultCapabilities({ handoffsEnabled: false });
    expect(actorFromSessionCredential(credential)).toBeUndefined();
    expect(actorFromSessionCredential(`${session.id}.forged`, { allowMissing: true })).toBeUndefined();
    const actor = actorFromSessionCredential(credential, { allowMissing: true });
    const replay = await runAction('report_result', input, { remote: true, actor });
    expect(replay.ok).toBe(true);
    expect((replay.result as { result_id: string }).result_id).toBe((created.result as { result_id: string }).result_id);
    expect((replay.result as { idempotent_replay: boolean }).idempotent_replay).toBe(true);
    expect((await runAction('report_result', { ...input, request_id: 'new-after-prune' }, { remote: true, actor })).ok).toBe(false);
    expect(q.listWorkResults()).toHaveLength(1);
  });

  it('enforces assigned reviewer authority across HTTP reads and mutations', async () => {
    const gates = await import('@/lib/work-results/capabilities');
    const { writeAuthConfig } = await import('@/lib/auth/config-file');
    const { sessionCredential, SESSION_CREDENTIAL_HEADER } = await import('./session-credential');
    const q = await import('@/lib/db/queries');
    gates.setWorkResultCapabilities({ handoffsEnabled: true, aiReviewEnabled: true });
    writeAuthConfig({ localToken: 'reviewer-http-test-token' });
    const human = { userId: 'local', source: 'human' as const };
    const target = q.createWorkResult(human, { requestId: 'target', body: 'Assigned work.' }).result;
    const privateOther = q.createWorkResult(human, { requestId: 'other', body: 'Other work.' }).result;
    const review = q.createWorkResultAiReview(human, { requestId: 'review', resultId: target.id, brief: 'Inspect this exact work.',
      selection: { harness: 'claude', model: 'opus', variant: null, effort: null },
      scope: { requested: { resultId: target.id, capturedAt: '2026-10-07T00:00:00Z', attachments: [] } },
      provenance: { method: 'fresh_session', independence: 'observed' } }).review;
    const reviewer = q.createChatSession({ harness: 'claude', type: 'orchestration', surfaceKind: 'result_review', surfaceRef: review.id });
    const run = q.createRun({ harness: 'claude', triggerKind: 'manual', chatSessionId: reviewer.id });
    q.linkWorkResultAiReviewRuntime(review.id, { reviewerSessionId: reviewer.id, runId: run.id });
    const headers = { [SESSION_CREDENTIAL_HEADER]: sessionCredential(reviewer.id)! };
    const { GET: getExactResult } = await import('@/app/api/results/[id]/route');
    const { GET: list } = await import('@/app/api/results/route');
    const { POST: decision } = await import('@/app/api/results/[id]/decisions/route');
    const allowed = await getExactResult(new Request(`http://localhost/api/results/${target.id}`, { headers }), { params: Promise.resolve({ id: target.id }) });
    expect(allowed.status).toBe(200);
    const forbidden = await getExactResult(new Request(`http://localhost/api/results/${privateOther.id}`, { headers }), { params: Promise.resolve({ id: privateOther.id }) });
    expect(forbidden.status).toBe(403);
    expect((await list(new Request('http://localhost/api/results', { headers }))).status).toBe(403);
    const acceptance = await decision(new Request(`http://localhost/api/results/${target.id}/decisions`, { method: 'POST', headers,
      body: JSON.stringify({ requestId: 'forbidden-accept', disposition: 'accepted' }) }), { params: Promise.resolve({ id: target.id }) });
    expect(acceptance.status).toBe(403);
    expect(q.getWorkResult(target.id)!.reviews).toEqual([]);
  });

  it('returns clear disabled stale-MCP errors while preserving an exact committed HTTP report replay', async () => {
    const { runAction } = await import('./dispatch');
    const gates = await import('@/lib/work-results/capabilities');
    const { sessionCredential, SESSION_CREDENTIAL_HEADER } = await import('./session-credential');
    const { subscribe, sessionChannel } = await import('@/lib/realtime/bus');
    const q = await import('@/lib/db/queries');
    gates.setWorkResultCapabilities({ handoffsEnabled: true });
    const session = q.createChatSession({ harness: 'claude', type: 'orchestration' });
    const events: unknown[] = [];
    const unsubscribe = subscribe(sessionChannel(session.id), (event) => events.push(event));
    const input = { request_id: 'http-saved', body: 'Saved through the running server.' };
    const context = { remote: true, actor: { source: 'ai' as const, sessionId: session.id } };
    const created = await runAction('report_result', input, context);
    expect(created.ok).toBe(true);
    expect(events).toHaveLength(1);
    gates.setWorkResultCapabilities({ handoffsEnabled: false });
    const { POST } = await import('@/app/api/orchestrator/results/[transport]/route');
    const call = async (arguments_: unknown) => {
      const response = await POST(new Request('http://localhost/api/orchestrator/results/mcp', {
        method: 'POST', headers: { 'Content-Type': 'application/json', [SESSION_CREDENTIAL_HEADER]: sessionCredential(session.id)! },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'report_result', arguments: arguments_ } }),
      }));
      const message = await response.json() as { result: { content: Array<{ text: string }>; isError: boolean } };
      return { message, envelope: JSON.parse(message.result.content[0].text) as { ok: boolean; result?: { idempotent_replay: boolean }; error?: { code: string; message: string } } };
    };
    try {
      const replay = await call(input);
      expect(replay.envelope.ok).toBe(true);
      expect(replay.envelope.result?.idempotent_replay).toBe(true);
      expect(replay.message.result.isError).toBe(false);
      const { handleUndiscoveredResultCall } = await import('./result-actions');
      const retainedRead = await handleUndiscoveredResultCall(new Request('http://localhost/api/orchestrator/mcp', {
        method: 'POST', headers: { 'Content-Type': 'application/json', [SESSION_CREDENTIAL_HEADER]: sessionCredential(session.id)! },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_result', arguments: { id: (created.result as { result_id: string }).result_id } } }),
      }));
      const retainedEnvelope = await retainedRead!.json();
      expect(JSON.parse(retainedEnvelope.result.content[0].text).ok).toBe(true);
      const disabled = await call({ ...input, request_id: 'stale-new-call' });
      expect(disabled.envelope.error?.code).toBe('unsupported');
      expect(disabled.envelope.error?.message).toContain('disabled');
      expect(disabled.message.result.isError).toBe(true);
      expect((await call({ ...input, body: 'Changed meaning' })).envelope.error?.code).toBe('conflict');
      expect(events).toHaveLength(1);
      expect(q.listWorkResults()).toHaveLength(1);
    } finally { unsubscribe(); }
  });

  it('rejects contradictory claimed source or actor metadata instead of stripping it', async () => {
    const { runAction } = await import('./dispatch');
    const gates = await import('@/lib/work-results/capabilities');
    const q = await import('@/lib/db/queries');
    gates.setWorkResultCapabilities({ handoffsEnabled: true });
    const session = q.createChatSession({ harness: 'claude', type: 'orchestration' });
    const context = { remote: true, actor: { source: 'ai' as const, sessionId: session.id } };
    const response = await runAction('report_result', { request_id: 'source-claim', body: 'Useful work', source_chat_session_id: 'another-session', actor_source: 'human' }, context);
    expect(response.error?.code).toBe('invalid_params');
    expect(q.listWorkResults()).toEqual([]);
  });

  it('retains selected human Save Markdown verbatim through the HTTP creator and source-pruned retry', async () => {
    const gates = await import('@/lib/work-results/capabilities');
    const q = await import('@/lib/db/queries');
    const { getDb } = await import('@/lib/db');
    const { chatEvents, chatSessions } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const { POST } = await import('@/app/api/results/route');
    gates.setWorkResultCapabilities({ handoffsEnabled: true });
    const session = q.createChatSession({ harness: 'claude', type: 'orchestration' });
    const body = '    code with significant indentation\n\nA useful explanation.\n\n';
    getDb().insert(chatEvents).values({ id: 'selected-verbatim-output', sessionId: session.id, role: 'assistant', source: 'agent', content: body }).run();
    const input = { requestId: 'verbatim-save', sourceChatSessionId: session.id, sourceEventId: 'selected-verbatim-output', body };
    const save = (value: typeof input) => POST(new Request('http://localhost/api/results', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
    }));
    const response = await save(input);
    expect(response.status).toBe(200);
    const created = await response.json() as { resultId: string; replayed: boolean };
    expect(q.getWorkResult(created.resultId)!.result.body).toBe(body);
    const changed = await save({ ...input, requestId: 'trimmed-save', body: body.trim() });
    expect(changed.status).toBe(422);
    expect((await changed.json()).code).toBe('invalid_params');
    getDb().delete(chatSessions).where(eq(chatSessions.id, session.id)).run();
    gates.setWorkResultCapabilities({ handoffsEnabled: false });
    const replay = await save(input);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ resultId: created.resultId, replayed: true });
    expect(q.getWorkResult(created.resultId)!.result.body).toBe(body);
    expect(q.listWorkResults()).toHaveLength(1);
  });
});
