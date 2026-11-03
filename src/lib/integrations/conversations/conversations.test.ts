import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import * as q from '@/lib/db/queries';
import { acceptExternalConversation, conversationPrincipal, drainConversations, stopConversations } from './service';
import { conversationHash, saveConversationSecrets } from './secrets';
import * as slack from './slack';

let home: TestHome;
let harness: FakeHarness;
let keyId: string;
let connection: ReturnType<typeof q.createConversationConnection>;
let sent: Array<{ method: string; body: Record<string, unknown> }>;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-conversations-' });
  (await import('@/lib/home/identity')).ensureHomeIdentity();
  harness = installFakeHarness('claude');
  q.updateUserState({ defaultHarness: 'claude' });
  keyId = q.pairDevice({ name: 'Owner', kind: 'computer' }).key.id;
  connection = q.createConversationConnection({ id: uuidv7(), name: 'Ri Personal', provider: 'slack', workspaceId: null, enabled: true, externalWorkspaceId: 'T001', externalAgentId: 'UBOT', channels: ['C001'] });
  await saveConversationSecrets(connection.id, { botToken: 'xoxb-fixture', appToken: 'xapp-fixture' });
  link('U001');
  sent = [];
  vi.spyOn(slack, 'refreshSlackSockets').mockResolvedValue();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const method = String(url).split('/').at(-1)!;
    sent.push({ method, body: JSON.parse(String(init.body)) });
    return Response.json({ ok: true, ts: '123.456' });
  }));
});
afterEach(async () => {
  await stopConversations();
  const executor = await import('@/lib/executor/adapter');
  for (const id of executor.listRunningSessions()) await executor.abort(id);
  await vi.waitFor(() => expect(executor.listRunningSessions()).toHaveLength(0));
  executor._resetExecutorState();
  harness?.restore();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  (await import('@/lib/home/authority')).resetAuthorityCache();
  await home?.cleanup();
});
function link(userId: string) {
  const code = 'a'.repeat(48);
  q.createConversationLink({ connectionId: connection.id, apiKeyId: keyId, memberId: null, codeHash: conversationHash(code) });
  return q.consumeConversationLink(connection.id, userId, conversationHash(code))!;
}
function event(text: string, options: { ts?: string; root?: string; channel?: string; user?: string; type?: string; subtype?: string } = {}) {
  return slack.acceptSlackEvent(connection, { team_id: 'T001', event_id: uuidv7(), event: { type: options.type ?? 'app_mention', user: options.user ?? 'U001', channel: options.channel ?? 'C001', ts: options.ts ?? '123.000001', thread_ts: options.root, subtype: options.subtype, text } });
}
function savedThread(channelId = 'C001', threadId = '123.000001') {
  const thread = q.ensureConversationThread(connection.id, channelId, threadId);
  const input = q.acceptConversationInput({ threadId: thread.id, identityId: q.conversationIdentity(connection.id, 'U001')!.id,
    externalEventId: uuidv7(), content: 'Previously accepted message', kind: 'message' });
  q.finishConversationInput(input.id, 'accepted');
  return thread;
}

it('runs a real Ri conversation from a Slack mention, deduplicates it, and returns the reply to its thread', async () => {
  harness.onTurn(async turn => {
    expect(turn.message).toContain('Review the release');
    expect(turn.message).toContain('Response format for this Slack conversation');
    expect(turn.message).toContain("replace Ri's UI-only entity-reference");
    expect(turn.message).toContain('actual task, note, area and agent names');
    await turn.say('The release checklist is ready.');
  });
  const accepted = event('<@UBOT> Review the release');
  expect(accepted).toMatchObject({ accepted: true });
  expect(event('<@UBOT> Review the release')).toMatchObject({ inputId: accepted?.inputId });
  await drainConversations();
  await vi.waitFor(() => expect(sent.filter(row => row.method === 'chat.postMessage')).toHaveLength(1), { timeout: 15_000 });
  expect(sent.find(row => row.method === 'chat.postMessage')?.body).toMatchObject({ channel: 'C001', thread_ts: '123.000001', text: 'The release checklist is ready.' });
  const thread = q.getConversationThread(accepted!.threadId!)!;
  expect(q.getChatSession(thread.sessionId!)).toMatchObject({ type: 'orchestration', workspaceId: null });
  expect(harness.sessions).toHaveLength(1);
  expect(q.getConversationInput(accepted!.inputId!)?.status).toBe('accepted');
  expect(q.conversationOutputsForConnection(connection.id)).toHaveLength(0);
  expect(event('And the rollout?', { type: 'message', ts: '123.000002', root: '123.000001' })).toMatchObject({ accepted: true, threadId: thread.id });
}, 20_000);

it('ignores channel chatter, other bots, edits and unlinked users', () => {
  expect(event('Ordinary discussion', { type: 'message' })).toMatchObject({ accepted: false });
  expect(event('<@UBOT> quoted text', { user: 'UBOT' })).toBeUndefined();
  expect(event('Edited', { subtype: 'message_changed' })).toBeUndefined();
  expect(event('<@UBOT> private tasks?', { user: 'UOTHER' })).toMatchObject({ accepted: false });
  expect(q.dueConversationInputs()).toHaveLength(0);
});

it('returns a runtime question to Slack and delivers the answer to its pending resolver', async () => {
  harness.onTurn(async turn => {
    const answer = await turn.ask({ toolName: 'AskUserQuestion', input: { questions: [{ question: 'Ship today?', header: 'Release', multiSelect: false, options: [{ label: 'Yes', description: 'Ship today' }, { label: 'No', description: 'Wait' }] }] } });
    expect(answer.updatedInput).toMatchObject({ answers: { 'Ship today?': 'Yes' } });
    await turn.say('Confirmed. Shipping today.');
  });
  const accepted = event('<@UBOT> Plan the release')!;
  await drainConversations();
  await vi.waitFor(() => expect(q.conversationOutputsForConnection(connection.id).some(row => row.kind === 'question') || sent.some(row => String(row.body.text).includes('Ship today?'))).toBe(true), { timeout: 15_000 });
  const answer = event('Yes', { type: 'message', ts: '123.000002', root: '123.000001' })!;
  await drainConversations();
  await vi.waitFor(() => expect(sent.some(row => row.body.text === 'Confirmed. Shipping today.')).toBe(true), { timeout: 15_000 });
  expect(q.getConversationInput(answer.inputId!)?.status).toBe('accepted');
  expect(q.getConversationThread(accepted.threadId!)?.sessionId).toBeTruthy();
}, 20_000);

it('stops a running turn and does not launch earlier queued follow-ups afterward', async () => {
  harness.onTurn(async turn => { await new Promise<void>(resolve => turn.signal.addEventListener('abort', () => resolve(), { once: true })); });
  const first = event('<@UBOT> Work until stopped')!;
  await drainConversations();
  await vi.waitFor(() => expect(harness.sessions[0]?.messages).toHaveLength(1));
  const queued = event('Do another thing', { type: 'message', ts: '123.000002', root: '123.000001' })!;
  event('stop', { type: 'message', ts: '123.000003', root: '123.000001' });
  await drainConversations();
  expect(q.getConversationInput(queued.inputId!)).toMatchObject({ status: 'failed', error: expect.stringContaining('Stopped') });
  expect(harness.sessions[0].messages).toHaveLength(1);
  expect(q.getConversationInput(first.inputId!)?.status).toBe('accepted');
}, 20_000);

it('handles Stop before a full batch of queued work can start', async () => {
  event('<@UBOT> Queued work', { ts: '124.000001' });
  for (let index = 2; index <= 51; index++) event(`More queued work ${index}`, { type: 'message', ts: `124.${String(index).padStart(6, '0')}`, root: '124.000001' });
  const stop = event('stop', { type: 'message', ts: '124.000052', root: '124.000001' })!;
  await drainConversations();
  expect(q.getConversationInput(stop.inputId!)?.status).toBe('accepted');
  expect(q.hasQueuedConversationInputs(stop.threadId!)).toBe(false);
  expect(harness.sessions).toHaveLength(0);
});

it('keeps Slack DM follow-ups in their native session thread and separates new sessions', () => {
  const first = event('Hello', { channel: 'D001', type: 'message' });
  const second = event('Follow up', { channel: 'D001', type: 'message', ts: '123.000002', root: '123.000001' });
  expect(first).toMatchObject({ accepted: true, threadId: second!.threadId });
  expect(event('New session', { channel: 'D001', type: 'message', ts: '123.000003' })?.threadId).not.toBe(first!.threadId);
  expect(q.getConversationThread(first!.threadId!)?.threadId).toBe('123.000001');
  expect(() => event('Changed retry', { channel: 'D001', type: 'message' })).toThrow('different input');
});

it('returns a personal DM reply in its native Slack session and accepts the native Stop payload', async () => {
  harness.onTurn(async turn => { await turn.say('Reply in this DM thread.'); });
  const accepted = event('Hello', { channel: 'D001', type: 'message' })!;
  await drainConversations();
  await vi.waitFor(() => expect(sent.some(row => row.method === 'chat.postMessage')).toBe(true), { timeout: 15_000 });
  expect(sent.find(row => row.method === 'chat.postMessage')?.body).toMatchObject({ channel: 'D001', thread_ts: '123.000001' });
  expect(sent.find(row => row.method === 'agents.sessions.setStatus')?.body).toMatchObject({ channel_id: 'D001', thread_ts: '123.000001', status: 'processing' });
  const stop = slack.acceptSlackEvent(connection, { team_id: 'T001', event_id: 'stop-native', event: {
    type: 'agent_session_stopped', user: 'U001', channel: 'D001', thread_ts: '123.000001', event_ts: '123.000002' } });
  expect(stop).toMatchObject({ accepted: true, threadId: accepted.threadId });
  expect(q.getConversationInput(stop!.inputId!)?.kind).toBe('stop');
}, 20_000);

it('does not deliver a private reply after its participant unlinks, even when another identity remains active', async () => {
  const thread = savedThread('D001');
  q.queueConversationOutput(thread.id, 'private-reply', 'Personal information');
  link('UOTHER');
  q.revokeConversationIdentity(q.conversationIdentity(connection.id, 'U001')!.id, keyId);
  await slack.deliverSlackOutputs();
  expect(sent.filter(row => row.method === 'chat.postMessage')).toHaveLength(0);
  expect(q.conversationOutputsForConnection(connection.id)[0]).toMatchObject({ status: 'pending', error: expect.stringContaining('No linked Ri sign-in') });
});

it('preserves event reservations across unlinking and relinking without running queued work as a new identity', async () => {
  const accepted = event('<@UBOT> Run once')!;
  const identity = q.conversationIdentity(connection.id, 'U001')!;
  q.revokeConversationIdentity(identity.id, keyId);
  link('U001');
  expect(q.getConversationInput(accepted.inputId!)).not.toBeNull();
  expect(() => event('<@UBOT> Run once')).toThrow('different input');
  await drainConversations();
  expect(harness.sessions).toHaveLength(0);
  expect(q.getConversationInput(accepted.inputId!)?.status).toBe('failed');
});

it('links only with a live one-time code and checks revoked sign-ins again', () => {
  const identity = q.conversationIdentity(connection.id, 'U001')!;
  q.revokeApiKey(keyId);
  expect(() => conversationPrincipal(identity)).toThrow('no longer active');
  expect(event('Read my private notes')).toMatchObject({ accepted: false, reason: expect.stringContaining('no longer active') });
  expect(q.consumeConversationLink(connection.id, 'UOTHER', conversationHash('a'.repeat(48)))).toBeNull();
});

it('retries a failed Slack reply without repeating the model and resumes long replies at the next part', async () => {
  const thread = savedThread();
  q.queueConversationOutput(thread.id, 'long-reply', 'x'.repeat(6500));
  const output = q.conversationOutputsForConnection(connection.id)[0];
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    calls++;
    if (calls === 2) return Response.json({ ok: false, error: 'ratelimited' });
    return Response.json({ ok: true });
  }));
  await slack.deliverSlackOutputs();
  expect(q.getConversationOutput(output.id)).toMatchObject({ status: 'pending', part: 1 });
  q.updateConversationOutput(output.id, { nextAttemptAt: new Date(0).toISOString() });
  await slack.deliverSlackOutputs();
  expect(q.getConversationOutput(output.id)).toMatchObject({ status: 'sent', part: 3 });
  expect(harness.sessions).toHaveLength(0);
});

it('resolves Ri cards and Markdown once before Slack delivery and keeps retries stable', async () => {
  const task = q.createTask({ title: 'Ship the release' });
  const area = q.createArea({ name: 'Product & engineering' });
  const thread = savedThread();
  q.queueConversationOutput(thread.id, 'card-reply', `**Due Thursday**\n\n[[task:${task.id}]]\n\n[[area:${area.id}]]`);
  const output = q.conversationOutputsForConnection(connection.id)[0];
  expect(output.content).toBe('*Due Thursday*\n\nShip the release\n\nProduct &amp; engineering');
  let posts = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ method: String(url).split('/').at(-1)!, body: JSON.parse(String(init.body)) });
    return Response.json(++posts === 1 ? { ok: false, error: 'ratelimited' } : { ok: true });
  }));
  await slack.deliverSlackOutputs();
  expect(q.getConversationOutput(output.id)?.status).toBe('pending');
  q.updateTask(task.id, { title: 'Changed after the reply was queued' }, { source: 'human' });
  q.updateConversationOutput(output.id, { nextAttemptAt: new Date(0).toISOString() });
  await slack.deliverSlackOutputs();
  expect(sent.filter(row => row.method === 'chat.postMessage').map(row => row.body.text)).toEqual([output.content, output.content]);
  expect(q.getConversationOutput(output.id)?.status).toBe('sent');
});

it('rotates Slack credentials while preserving the linked conversation and unsent reply parts', async () => {
  const thread = savedThread();
  q.queueConversationOutput(thread.id, 'saved-reply', 'x'.repeat(6500));
  const output = q.conversationOutputsForConnection(connection.id)[0];
  q.updateConversationOutput(output.id, { status: 'failed', part: 1, error: 'token_revoked' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const method = String(url).split('/').at(-1)!;
    sent.push({ method, body: JSON.parse(String(init.body)) });
    return Response.json({ ok: true, team_id: 'T001', user_id: 'UBOT' });
  }));
  const { conversationIntegrationsRouter } = await import('./router');
  const caller = conversationIntegrationsRouter.createCaller({ key: { apiKeyId: keyId, scope: 'viewer', location: 'elsewhere', sessionChatId: null, workerDeviceId: null }, request: new Request('http://localhost/api/trpc') });
  expect(await caller.reconnectSlack({ id: connection.id, botToken: 'xoxb-new-fixture', appToken: 'xapp-new-fixture' })).toMatchObject({ ok: true });
  await drainConversations();
  expect(q.findConversationThread(connection.id, 'C001', '123.000001')?.id).toBe(thread.id);
  expect(q.getConversationOutput(output.id)).toMatchObject({ status: 'sent', part: 3 });
  expect(sent.filter(row => row.method === 'chat.postMessage')).toHaveLength(2);
  expect(harness.sessions).toHaveLength(0);
});

it('reports uncertain persisted input after restart instead of dispatching its work twice', async () => {
  const accepted = event('<@UBOT> Launch once')!;
  const input = q.getConversationInput(accepted.inputId!)!;
  const session = q.createChatSession({ type: 'orchestration', harness: 'claude' });
  q.bindConversationThread(input.threadId, session.id);
  q.insertChatEvent({ id: input.eventId, sessionId: session.id, role: 'user', source: 'user', content: input.content });
  await drainConversations();
  expect(harness.sessions).toHaveLength(0);
  expect(sent.find(row => row.method === 'chat.postMessage')?.body.text).toContain('restarted');
});

it('does not accept a message from a different workspace or an unconnected channel', () => {
  expect(() => slack.acceptSlackEvent(connection, { team_id: 'TOTHER', event_id: 'bad', event: { type: 'app_mention' } })).toThrow('workspace');
  expect(event('<@UBOT> Act', { channel: 'COTHER' })).toMatchObject({ accepted: false });
});

it('returns a restarted run failure even when the model emitted no assistant text', async () => {
  const thread = savedThread('C001', 'root');
  const session = q.createChatSession({ type: 'orchestration', harness: 'claude' });
  q.bindConversationThread(thread.id, session.id);
  const run = q.createRun({ chatSessionId: session.id, harness: 'claude', triggerKind: 'manual', status: 'queued' });
  q.bindConversationRun(session.id, run.id);
  q.markRunFailed(run.id, { errorCode: 'interrupted', errorMessage: 'Interrupted by restart.' });
  await drainConversations();
  expect(sent.find(row => row.method === 'chat.postMessage')?.body.text).toContain('Interrupted by restart');
  expect(harness.sessions).toHaveLength(0);
});

it('relays human continuation and the resulting reply from Ri without echoing Slack input', async () => {
  harness.onTurn(async turn => {
    expect(turn.message).toContain('Response format for this Slack conversation');
    await turn.say(turn.message.includes('Check again') ? 'Checked again.' : 'First answer.');
  });
  const accepted = event('<@UBOT> Hello')!;
  await drainConversations();
  await vi.waitFor(() => expect(sent.some(row => row.body.text === 'First answer.')).toBe(true), { timeout: 15_000 });
  const thread = q.getConversationThread(accepted.threadId!)!;
  const { POST } = await import('@/lib/server/operations/sessions/[id]/messages');
  const { API_KEY_ID_HEADER, API_KEY_SCOPE_HEADER } = await import('@/lib/auth/request-key');
  const url = new URL(`http://localhost/api/sessions/${thread.sessionId}/messages`);
  const result = await POST({ params: { id: thread.sessionId! }, body: { id: uuidv7(), content: 'Check again' } },
    { url: url.toString(), nextUrl: url, signal: new AbortController().signal, headers: new Headers({ [API_KEY_ID_HEADER]: keyId, [API_KEY_SCOPE_HEADER]: 'viewer' }) });
  expect(result.ok).toBe(true);
  await vi.waitFor(() => expect(sent.filter(row => row.method === 'chat.postMessage')).toHaveLength(3), { timeout: 15_000 });
  expect(sent.filter(row => row.method === 'chat.postMessage').map(row => row.body.text)).toEqual(['First answer.', 'From Ri:\nCheck again', 'Checked again.']);
}, 20_000);

it('allows a linked Buzz host only in explicitly configured channels', () => {
  const buzz = q.createConversationConnection({ id: uuidv7(), name: 'Ri Buzz', provider: 'buzz', workspaceId: null, enabled: true, externalWorkspaceId: 'ws://localhost:3000', externalAgentId: uuidv7(), channels: ['channel-one'] });
  q.createConversationLink({ connectionId: buzz.id, apiKeyId: keyId, memberId: null, codeHash: conversationHash('b'.repeat(48)) });
  q.consumeConversationLink(buzz.id, 'acp-host', conversationHash('b'.repeat(48)));
  const input = { connectionId: buzz.id, channelId: 'channel-one', threadId: 'root', externalEventId: 'one', externalUserId: 'acp-host', content: 'Hello', mentioned: true };
  expect(acceptExternalConversation(input)).toMatchObject({ accepted: true });
  expect(acceptExternalConversation({ ...input, channelId: 'another-channel' })).toMatchObject({ accepted: false });
});
