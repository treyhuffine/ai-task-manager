import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as q from '@/lib/db/queries';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { conversationIntegrationsRouter } from './router';
import * as slack from './slack';
import { drainConversations, startConversations, stopConversations } from './service';
import type { RequestKey } from '@/lib/auth/request-key';
import { conversationHash } from './secrets';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let harness: FakeHarness;
let calls: Array<{ method: string; body: Record<string, unknown> }>;
beforeEach(async () => {
  fixture = await createTeamExecutionFixture();
  harness = installFakeHarness('claude');
  q.saveTeamAiSettings({ enabled: true, harness: 'claude', model: 'fake-model' }, fixture.owner.member.id);
  vi.spyOn(slack, 'refreshSlackSockets').mockResolvedValue();
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: String(url).split('/').at(-1)!, body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true, team_id: 'T001', user_id: 'UBOT' });
  }));
});
afterEach(async () => {
  await stopConversations();
  const executor = await import('@/lib/executor/adapter');
  await (await import('@/lib/team/ai/chat')).stopTeamAiWork({}, 'Test finished.');
  await (await import('@/lib/team/ai/chat')).settledTeamAi();
  executor._resetExecutorState(); harness?.restore();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  await fixture?.cleanup();
});
function caller(who: Pick<typeof fixture.owner, 'key' | 'member'>) {
  const key: RequestKey = { apiKeyId: who.key.id, scope: 'member', location: 'elsewhere', memberId: who.member.id, memberRole: who.member.role, sessionChatId: null, workerDeviceId: null };
  return conversationIntegrationsRouter.createCaller({ key, request: new Request('http://localhost/api/trpc') });
}
async function connect() {
  return (await caller(fixture.owner).create({ provider: 'slack', name: 'Ri Team', workspaceId: fixture.workspace.id, channels: ['CTEAM'], botToken: 'xoxb-fixture', appToken: 'xapp-fixture' })).connection;
}
async function link(connectionId: string, user: string, who: Pick<typeof fixture.owner, 'key' | 'member'>) {
  const result = await caller(who).link({ id: connectionId });
  return q.consumeConversationLink(connectionId, user, conversationHash(result.command.slice(5)))!;
}
function message(connection: Awaited<ReturnType<typeof connect>>, ts: string, user = 'UMAYA', channel = 'CTEAM') {
  return slack.acceptSlackEvent(connection, { team_id: 'T001', event_id: `event-${ts}`, event: { type: 'app_mention', user, channel, ts, text: '<@UBOT> Review the team release plan.' } });
}

it('runs a Slack request as the linked team member through the native team agent and returns to the shared thread', async () => {
  const connection = await connect();
  await link(connection.id, 'UMAYA', fixture.member);
  let requestingMember: string | undefined;
  harness.onTurn(async turn => {
    const chat = q.listTeamChats().find(chat => q.runningTeamChatTurn(chat.id));
    requestingMember = chat ? q.runningTeamChatTurn(chat.id)?.memberId : undefined;
    expect(turn.message).toContain('Maya');
    await turn.say('The team release plan is ready.');
  });
  const accepted = message(connection, '100.000001')!;
  expect(accepted).toMatchObject({ accepted: true });
  await drainConversations();
  await vi.waitFor(() => expect(calls.some(call => call.method === 'chat.postMessage' && call.body.text === 'The team release plan is ready.')).toBe(true), { timeout: 15_000 });
  const thread = q.getConversationThread(accepted.threadId!)!;
  expect(requestingMember).toBe(fixture.member.member.id);
  expect(q.getTeamChat(thread.sessionId!)).toMatchObject({ workspaceId: fixture.workspace.id });
  const event = q.getChatEventById(q.getConversationInput(accepted.inputId!)!.eventId);
  expect(event?.authorMemberId).toBe(fixture.member.member.id);
  expect(harness.sessions).toHaveLength(1);
}, 20_000);

it('allows members to link themselves but only a permitted human to configure team connections', async () => {
  await expect(caller(fixture.member).create({ provider: 'buzz', name: 'Unauthorized', workspaceId: fixture.workspace.id, channels: ['test'], relay: 'ws://localhost:3000' })).rejects.toThrow();
  const connection = await connect();
  const identity = await link(connection.id, 'UMAYA', fixture.member);
  expect(identity).toMatchObject({ apiKeyId: fixture.member.key.id, memberId: fixture.member.member.id });
  expect(await caller(fixture.member).list()).toMatchObject({ canManage: false, team: true });
});

it('lets a non-owner authorize their own owner-gated Buzz bridge and runs with that member attribution', async () => {
  startConversations();
  const channelId = '12345678-1234-4234-8234-123456789abc';
  const created = await caller(fixture.owner).create({ provider: 'buzz', name: 'Ri for Maya', workspaceId: fixture.workspace.id,
    channels: [channelId], relay: 'ws://localhost:3000' });
  const linked = await caller(fixture.member).link({ id: created.connection.id });
  expect(linked.bridgeCommand).toContain('${RI_CONVERSATION_TOKEN}');
  const { POST } = await import('@/app/api/integrations/conversations/acp/[connectionId]/route');
  const send = (text: string, eventId: string) => POST(new Request(created.bridgeUrl, { method: 'POST',
    headers: { Authorization: `Bearer ${created.bridgeToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'prompt', channelId, threadId: 'buzz-root', eventId, text }) }), { params: Promise.resolve({ connectionId: created.connection.id }) });
  expect(await (await send(linked.command, 'link')).json()).toMatchObject({ linked: true });
  expect(q.conversationIdentity(created.connection.id, 'acp-host')).toMatchObject({ apiKeyId: fixture.member.key.id, memberId: fixture.member.member.id });
  harness.onTurn(async turn => { expect(turn.message).toContain('Maya'); await turn.say('Maya’s Buzz request is done.'); });
  const accepted = await (await send('Review our plan.', 'request')).json();
  expect(accepted).toMatchObject({ accepted: true });
  await drainConversations();
  await vi.waitFor(() => expect(q.conversationOutputsForConnection(created.connection.id).map(output => output.content)).toContain('Maya’s Buzz request is done.'), { timeout: 15_000 });
  expect(q.getChatEventById(q.getConversationInput(accepted.inputId)!.eventId)?.authorMemberId).toBe(fixture.member.member.id);
}, 20_000);

it('refuses private team DMs and rechecks a removed member before queued work starts', async () => {
  const connection = await connect();
  await link(connection.id, 'UMAYA', fixture.member);
  expect(message(connection, '100.000001', 'UMAYA', 'DPRIVATE')).toMatchObject({ accepted: false, reason: expect.stringContaining('team channel') });
  const accepted = message(connection, '100.000002')!;
  q.removeMember(fixture.member.member.id);
  await drainConversations();
  expect(q.getConversationInput(accepted.inputId!)).toMatchObject({ status: 'failed', error: expect.stringContaining('no longer active') });
  expect(harness.sessions).toHaveLength(0);
});

it('never dispatches Slack work through a disabled team AI', async () => {
  const connection = await connect();
  await link(connection.id, 'UMAYA', fixture.member);
  q.saveTeamAiSettings({ enabled: false }, fixture.owner.member.id);
  const accepted = message(connection, '100.000001')!;
  await drainConversations();
  expect(q.getConversationInput(accepted.inputId!)?.status).toBe('failed');
  expect(harness.sessions).toHaveLength(0);
});
