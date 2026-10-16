import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import type { ChatSessionRecord } from '@/db/types';
import { runAction } from '@/lib/orchestrator/dispatch';
import { verifySessionCredential } from '@/lib/orchestrator/session-credential';
import { drainAgentCoordination, recoverAgentCoordination } from './service';
import { finishRun } from '@/lib/runs/finish';
import { applyChatEvent } from '@/lib/executor/apply';

const fake = vi.hoisted(() => ({ busy: new Set<string>(), fetch: vi.fn(), dispatch: vi.fn(), abort: vi.fn() }));
vi.mock('@/lib/orchestrator/server-client', async (original) => ({ ...await original<object>(), serverFetch: fake.fetch }));
vi.mock('@/lib/executor/adapter', () => ({ isRunning: (id: string) => fake.busy.has(id), hasBackgroundTasks: () => false, dispatch: fake.dispatch, abort: fake.abort }));

let home: TestHome;
let main: ChatSessionRecord;
let agent: ReturnType<typeof q.createWorkspace>;
let agentMain: ChatSessionRecord;
let accepted: Array<{ sessionId: string; content: string; eventId: string; sender: string | null; runId: string }>;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-coordination-' });
  main = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' });
  agent = q.createWorkspace({ name: 'Frontend', cwd: home.root, isGit: false, filesToCopy: [] });
  agentMain = q.createChatSession({ type: 'orchestration', harness: 'claude', workspaceId: agent.id, status: 'active' });
  accepted = [];
  fake.busy.clear();
  fake.fetch.mockReset();
  fake.abort.mockReset();
  fake.dispatch.mockReset();
  fake.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const create = path.match(/^\/workspaces\/([^/]+)\/sessions$/);
    if (create) return q.createExecutionWithChat({ workspaceId: create[1], chatSessionId: body.sessionId, harness: body.harness ?? 'claude', label: body.label ?? null }).session;
    const send = path.match(/^\/sessions\/([^/]+)\/messages$/);
    if (!send) throw new Error(`Unexpected test server path: ${path}`);
    const sessionId = send[1];
    const existing = q.getChatEventById(body.id);
    if (existing) {
      if (existing.sessionId !== sessionId || existing.content !== body.content) throw new Error('message conflict');
      return existing;
    }
    const headers = init?.headers as Record<string, string> | undefined;
    const sender = verifySessionCredential(headers?.['x-ri-session'], home.token);
    const event = q.insertChatEvent({ id: body.id, sessionId, role: 'user', source: 'user', content: body.content, senderSessionId: sender })!;
    const chat = q.getChatSession(sessionId)!;
    const run = q.createRun({ harness: chat.harness, triggerKind: 'manual', status: 'queued', chatSessionId: sessionId, sourceEventId: event.id, executionId: chat.executionId });
    q.markRunStarted(run.id);
    q.bindAgentRequestRun(event.id, sessionId, run.id);
    fake.busy.add(sessionId);
    accepted.push({ sessionId, content: body.content, eventId: event.id, sender, runId: run.id });
    return event;
  });
  fake.dispatch.mockImplementation(async (id: string, _content: string, options: { sourceEventId: string; onTaken?: () => void }) => {
    const run = q.createRun({ harness: 'claude', triggerKind: 'manual', status: 'queued', chatSessionId: id, sourceEventId: options.sourceEventId });
    q.markRunStarted(run.id);
    options.onTaken?.();
  });
});

afterEach(async () => {
  await drainAgentCoordination();
  await home.cleanup();
});

function act(chat: ChatSessionRecord, name: string, input: unknown) {
  return runAction(name, input, { remote: true, actor: { source: 'ai', sessionId: chat.id } });
}

async function request(chat: ChatSessionRecord, name: string, input: unknown) {
  const result = await act(chat, name, input);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  await drainAgentCoordination();
  return result.result as ReturnType<typeof q.getAgentRequest> & {};
}

async function complete(sessionId: string, content: string) {
  const send = accepted.filter(row => row.sessionId === sessionId).at(-1)!;
  const id = uuidv7();
  applyChatEvent({ id, sessionId, role: 'assistant', source: 'agent', content }, { cumulative: false, runId: send.runId });
  fake.busy.delete(sessionId);
  finishRun(send.runId, { ok: true });
  await drainAgentCoordination();
  return id;
}

describe('durable agent conversations', () => {
  it('returns a consultation to its requester, with provenance and exactly one accepted send on retries', async () => {
    const input = { target: `agent:${agent.id}`, request_id: 'question-1', content: 'How should expired sessions behave?' };
    const ask = await request(main, 'ask_agent', input);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ sessionId: agentMain.id, sender: main.id });
    const again = await request(main, 'ask_agent', input);
    expect(again.id).toBe(ask.id);
    expect(accepted).toHaveLength(1);
    const answerId = await complete(agentMain.id, 'Redirect to login and preserve the destination.');
    expect(q.getAgentRequest(ask.id)).toMatchObject({ status: 'completed', responseEventId: answerId });
    expect(accepted.at(-1)).toMatchObject({ sessionId: main.id, sender: agentMain.id });
    expect(accepted.at(-1)!.content).toContain('preserve the destination');
    expect(q.listAgentDeliveries(ask.id)).toMatchObject([{ status: 'sent' }]);
    expect(await act(main, 'ask_agent', { ...input, content: 'Changed intent' })).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('closes the complete delegation, executor consultation, answer and resumed work loop', async () => {
    const delegated = await request(main, 'delegate_work', { workspace_id: agent.id, request_id: 'build-login', prompt: 'Fix session expiry.' });
    const work = q.getChatSession(q.getAgentRequest(delegated.id)!.targetSessionId!)!;
    const question = await request(work, 'ask_agent', { target: 'agent', request_id: 'expiry-context', content: 'What behavior did we agree on?' });
    expect(question.parentRequestId).toBe(delegated.id);
    await complete(work.id, 'Waiting for the project context.');
    expect(q.getAgentRequest(delegated.id)?.status).toBe('waiting');
    expect(accepted.filter(row => row.sessionId === main.id)).toHaveLength(0);
    await complete(agentMain.id, 'Preserve the destination after login.');
    expect(accepted.at(-1)!.sessionId).toBe(work.id);
    expect(q.getAgentRequest(delegated.id)?.status).toBe('sent');
    await complete(work.id, 'Implemented and verified the redirect.');
    expect(q.getAgentRequest(delegated.id)).toMatchObject({ status: 'completed', response: 'Implemented and verified the redirect.' });
    expect(accepted.at(-1)).toMatchObject({ sessionId: main.id, sender: work.id });
  });

  it('resolves an agent address after New chat instead of sending to the archived conversation', async () => {
    fake.busy.add(agentMain.id);
    const ask = await request(main, 'ask_agent', { target: `agent:${agent.id}`, request_id: 'later', content: 'Review this plan.' });
    expect(q.getAgentRequest(ask.id)?.status).toBe('queued');
    q.archiveChatSession(agentMain.id);
    const replacement = q.createChatSession({ type: 'orchestration', harness: 'claude', workspaceId: agent.id, status: 'active' });
    q.updateAgentRequest(ask.id, { nextAttemptAt: new Date(0).toISOString() });
    await drainAgentCoordination();
    expect(accepted[0].sessionId).toBe(replacement.id);
  });

  it('returns the result to the current orchestrator when its original main chat was replaced', async () => {
    const ask = await request(main, 'ask_agent', { target: `agent:${agent.id}`, request_id: 'keep-return', content: 'Explain this.' });
    q.archiveChatSession(main.id);
    const replacement = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' });
    await complete(agentMain.id, 'Here is the explanation.');
    expect(q.getAgentRequest(ask.id)?.status).toBe('completed');
    expect(accepted.at(-1)!.sessionId).toBe(replacement.id);
  });

  it('does not launch a queued consultation after its exact requesting chat is closed', async () => {
    const { session } = q.createExecutionWithChat({ workspaceId: agent.id, harness: 'claude', label: 'Work' });
    fake.busy.add(agentMain.id);
    const ask = await request(session, 'ask_agent', { target: 'agent', request_id: 'close-before-start', content: 'Need context.' });
    q.archiveChatSession(session.id);
    fake.busy.clear();
    q.updateAgentRequest(ask.id, { nextAttemptAt: new Date(0).toISOString() });
    await drainAgentCoordination();
    expect(q.getAgentRequest(ask.id)?.status).toBe('cancelled');
    expect(accepted).toHaveLength(0);
  });

  it('returns a failure when an exact target closes before queued work starts', async () => {
    fake.busy.add(agentMain.id);
    const ask = await request(main, 'ask_agent', { target: `session:${agentMain.id}`, request_id: 'target-closed', content: 'Need context.' });
    q.archiveChatSession(agentMain.id);
    fake.busy.clear();
    q.updateAgentRequest(ask.id, { nextAttemptAt: new Date(0).toISOString() });
    await drainAgentCoordination();
    expect(q.getAgentRequest(ask.id)).toMatchObject({ status: 'failed', nextAttemptAt: null });
    expect(accepted).toHaveLength(1);
    expect(accepted[0].sessionId).toBe(main.id);
    expect(accepted[0].content).toContain('archived');
    expect(q.listAgentDeliveries(ask.id)[0].status).toBe('sent');
  });

  it('retries delivery after an uncertain acknowledgment without repeating the recipient work', async () => {
    const ask = await request(main, 'ask_agent', { target: `agent:${agent.id}`, request_id: 'lost-ack', content: 'Explain.' });
    const normal = fake.fetch.getMockImplementation()!;
    let lose = true;
    fake.fetch.mockImplementation(async (...args) => {
      const result = await normal(...args);
      if (lose && args[0] === `/sessions/${main.id}/messages`) { lose = false; throw new Error('connection closed after acceptance'); }
      return result;
    });
    await complete(agentMain.id, 'The answer.');
    const delivery = q.listAgentDeliveries(ask.id)[0];
    expect(delivery.status).toBe('pending');
    fake.busy.delete(main.id);
    q.updateAgentDelivery(delivery.id, { nextAttemptAt: new Date(0).toISOString() });
    await drainAgentCoordination();
    expect(q.listAgentDeliveries(ask.id)[0].status).toBe('sent');
    expect(accepted.filter(row => row.sessionId === main.id)).toHaveLength(1);
  });

  it('makes explicit replies idempotent and refuses another chat forging an answer', async () => {
    const ask = await request(main, 'ask_agent', { target: `agent:${agent.id}`, request_id: 'reply', content: 'Question.' });
    expect(await act(main, 'reply_agent_request', { id: ask.id, content: 'Forged' })).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    expect(await act(agentMain, 'reply_agent_request', { id: ask.id, content: 'Answer' })).toMatchObject({ ok: true });
    expect(await act(agentMain, 'reply_agent_request', { id: ask.id, content: 'Answer' })).toMatchObject({ ok: true });
    expect(await act(agentMain, 'reply_agent_request', { id: ask.id, content: 'Different' })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    await drainAgentCoordination();
    expect(q.listAgentDeliveries(ask.id)).toHaveLength(1);
  });

  it('delivers a durable blocked update while leaving human-only permission approval intact', async () => {
    const ask = await request(main, 'ask_agent', { target: `agent:${agent.id}`, request_id: 'blocked', content: 'Investigate.' });
    q.queueAgentBlockedUpdates(agentMain.id, 'permission-one', 'Only a person can approve this permission.');
    q.queueAgentBlockedUpdates(agentMain.id, 'permission-one', 'Only a person can approve this permission.');
    await drainAgentCoordination();
    expect(q.listAgentDeliveries(ask.id)).toHaveLength(1);
    expect(accepted.at(-1)!.content).toContain('Human-only permission approvals remain with the user');
    expect(q.getAgentRequest(ask.id)?.status).toBe('sent');
  });

  it('marks interrupted local work failed on restart and never launches it again', async () => {
    const ask = await request(main, 'ask_agent', { target: `agent:${agent.id}`, request_id: 'restart', content: 'Investigate.' });
    fake.busy.clear();
    recoverAgentCoordination();
    await drainAgentCoordination();
    expect(q.getAgentRequest(ask.id)).toMatchObject({ status: 'failed' });
    expect(accepted.filter(row => row.sessionId === agentMain.id)).toHaveLength(1);
    expect(accepted.at(-1)!.content).toContain('was not repeated');
  });

  it('cancels delegated work, stops its execution and refuses cancellation by an unrelated chat', async () => {
    const work = await request(main, 'delegate_work', { workspace_id: agent.id, request_id: 'cancel', prompt: 'Investigate.' });
    expect(await act(agentMain, 'cancel_agent_request', { id: work.id })).toMatchObject({ ok: false });
    expect(await act(main, 'cancel_agent_request', { id: work.id })).toMatchObject({ ok: true });
    expect(fake.abort).toHaveBeenCalledWith(q.getAgentRequest(work.id)!.targetSessionId);
    expect(q.getAgentRequest(work.id)?.status).toBe('cancelled');
  });

  it('cancels descendant consultations without waking the cancelled execution', async () => {
    const work = await request(main, 'delegate_work', { workspace_id: agent.id, request_id: 'cancel-tree', prompt: 'Investigate.' });
    const execution = q.getChatSession(q.getAgentRequest(work.id)!.targetSessionId!)!;
    const child = await request(execution, 'ask_agent', { target: 'agent', request_id: 'child', content: 'Need context.' });
    expect(await act(main, 'cancel_agent_request', { id: work.id })).toMatchObject({ ok: true });
    fake.busy.delete(execution.id);
    await drainAgentCoordination();
    expect(q.getAgentRequest(child.id)?.status).toBe('cancelled');
    expect(q.listAgentDeliveries(child.id)[0]).toMatchObject({ status: 'failed' });
    expect(accepted.filter(row => row.sessionId === execution.id)).toHaveLength(1);
    expect(fake.abort).not.toHaveBeenCalledWith(agentMain.id);
  });

  it('returns launch failure as a system-authored update without starting a second execution', async () => {
    const normal = fake.fetch.getMockImplementation()!;
    fake.fetch.mockImplementation(async (...args) => {
      if (String(args[0]).startsWith('/workspaces/')) {
        const { ServerResponseError } = await import('@/lib/orchestrator/server-client');
        throw new ServerResponseError(409, JSON.stringify({ error: 'The device is unavailable.' }), 'Device unavailable');
      }
      return normal(...args);
    });
    const work = await request(main, 'delegate_work', { workspace_id: agent.id, request_id: 'failed-launch', prompt: 'Investigate.' });
    expect(q.getAgentRequest(work.id)).toMatchObject({ status: 'failed', targetSessionId: null });
    const delivery = q.listAgentDeliveries(work.id)[0];
    expect(delivery.status).toBe('sent');
    expect(q.getChatEventById(delivery.eventId)).toMatchObject({ source: 'error', role: 'system', senderSessionId: null });
    expect(fake.dispatch).toHaveBeenCalledOnce();
    expect(q.listChatSessions({ type: 'execution' })).toHaveLength(0);
  });

  it('keeps retries of low-level session messages on the same event ID', async () => {
    const input = { sessionId: agentMain.id, content: 'An update.', requestId: 'one-update' };
    expect(await act(main, 'send_session_message', input)).toMatchObject({ ok: true });
    expect(await act(main, 'send_session_message', input)).toMatchObject({ ok: true });
    expect(accepted).toHaveLength(1);
    expect((JSON.parse(String(fake.fetch.mock.calls[0][1].body))).id).toBe((JSON.parse(String(fake.fetch.mock.calls[1][1].body))).id);
  });

  it('does not accept unsigned, self-directed, team or internal reviewer requests', async () => {
    const input = { target: 'orchestrator', request_id: 'restricted', content: 'Do something.' };
    expect(await runAction('ask_agent', input, { remote: true })).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    expect(await act(main, 'ask_agent', input)).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    for (const surfaceKind of ['team_chat', 'result_review']) {
      const restricted = q.createChatSession({ harness: 'claude', type: 'orchestration', status: 'active', surfaceKind });
      expect(await act(restricted, 'ask_agent', input)).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    }
  });
});

describe('personal conversation retrieval', () => {
  it('searches main and content conversations while keeping team and reviewer history separate', async () => {
    const content = q.createChatSession({ type: 'content', harness: 'claude', status: 'active' });
    const team = q.createChatSession({ type: 'orchestration', harness: 'claude', surfaceKind: 'team_chat', status: 'active' });
    const reviewer = q.createChatSession({ type: 'execution', harness: 'claude', surfaceKind: 'result_review', status: 'active' });
    for (const chat of [main, agentMain, content, team, reviewer]) q.insertChatEvent({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'quartz retention decision' });
    const result = await act(main, 'search_sessions', { query: 'quartz' });
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.result as Array<{ sessionId: string }>).map(row => row.sessionId).sort()).toEqual([main.id, agentMain.id, content.id].sort());
    expect(await act(main, 'get_session_events', { session_id: team.id })).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  });

  it('pages equal-timestamp messages without gaps and retrieves long text without provider raw data', async () => {
    const text = 'A'.repeat(45_000);
    const events = Array.from({ length: 6 }, (_, n) => q.insertChatEvent({ id: uuidv7(), sessionId: agentMain.id, role: 'assistant', source: 'agent', content: n === 5 ? text : String(n), createdAt: '2026-10-15T12:00:00.000Z', raw: { privateProviderRecord: true } })!);
    const first = await act(main, 'get_session_events', { session_id: agentMain.id, limit: 3 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const page = first.result as { events: Array<{ id: string; content: string; raw?: unknown }>; next_before: string };
    expect(page.events.map(row => row.id)).toEqual(events.slice(3).map(row => row.id));
    expect(page.events.at(-1)!.content).toHaveLength(20_000);
    expect(page.events.some(row => 'raw' in row)).toBe(false);
    const second = await act(main, 'get_session_events', { session_id: agentMain.id, limit: 3, before: page.next_before });
    expect(second).toMatchObject({ ok: true, result: { hasOlder: false, events: events.slice(0, 3).map(row => ({ id: row.id })) } });
    let reconstructed = '';
    let offset: number | null = 0;
    while (offset !== null) {
      const chunk = await act(main, 'get_chat_event', { id: events[5].id, offset, max_chars: 10_000 });
      expect(chunk.ok).toBe(true);
      if (!chunk.ok) break;
      const part = chunk.result as { content: string; next_offset: number | null };
      reconstructed += part.content;
      offset = part.next_offset;
    }
    expect(reconstructed).toBe(text);
    const alien = q.insertChatEvent({ sessionId: main.id, source: 'user', role: 'user', content: 'cursor' })!;
    expect(await act(main, 'get_session_events', { session_id: agentMain.id, before: alien.id })).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  });

  it('keeps history reads on the session index and rejects another user\'s records', async () => {
    const { getRawDb } = await import('@/lib/db');
    const plans = getRawDb().prepare('EXPLAIN QUERY PLAN SELECT id, content FROM chat_events WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 21').all(main.id) as Array<{ detail: string }>;
    expect(plans.some(row => row.detail.includes('idx_chat_events_session_created'))).toBe(true);
    expect(plans.some(row => /SCAN chat_events\b/.test(row.detail))).toBe(false);
    const other = q.createChatSession({ harness: 'claude', type: 'orchestration', userId: 'other-user' });
    const event = q.insertChatEvent({ sessionId: other.id, role: 'assistant', source: 'agent', content: 'private zircon context' })!;
    expect(await act(main, 'get_chat_event', { id: event.id })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await act(main, 'search_sessions', { query: 'zircon' })).toMatchObject({ ok: true, result: [] });
  });
});
