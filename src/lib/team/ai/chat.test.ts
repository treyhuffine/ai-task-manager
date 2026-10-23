/** Durable queue and public adapters, using a held fake turn rather than an account. */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { fakeHarnessAuth, fakeHarnessRuntime } from '@/test/fixtures/harness-runtime';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import type { HarnessId } from '@/lib/harness/registry';
import type { RunTeamTurnInput, TeamTurnOutcome } from './turn-prompt';
import { settledTeamAi, stopTeamAiWork, setTeamAiRunnerForTests, resumeTeamAiAfterStart, kickTeamChat } from './chat';
import { teamAiTurnPrompt } from './turn-prompt';
import { runnerState } from '@/lib/runner/live-state';

const availability = vi.hoisted(() => ({ signedIn: true, beforeAuth: null as (() => Promise<void>) | null }));
vi.mock('@/lib/harness/runtime', async original => ({ ...await original<typeof import('@/lib/harness/runtime')>(),
  getHarnessRuntime: async (id: HarnessId) => fakeHarnessRuntime(id),
  resolveHarnessAuth: async (id: HarnessId) => { await availability.beforeAuth?.(); return fakeHarnessAuth(id, availability.signedIn); },
}));
vi.mock('@/lib/harness/start-selection', () => ({ resolveStartSelection: async (input: { providerId?: string; model?: string }) => ({ providerId: input.providerId ?? 'codex', model: input.model ?? 'gpt-6.1-sol', variant: null, effort: null }) }));

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let member: Awaited<ReturnType<typeof teamTrpc>>, owner: Awaited<ReturnType<typeof teamTrpc>>;
let calls: RunTeamTurnInput[];
let gates: Map<string, (outcome: TeamTurnOutcome) => void>;
let chat: ReturnType<typeof q.createChatSession>;
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); vi.stubGlobal('fetch', serveTeam);
  fixture = await createTeamExecutionFixture(); calls = []; gates = new Map();
  availability.signedIn = true; availability.beforeAuth = null;
  member = await teamTrpc(fixture.member.token.plaintext); owner = await teamTrpc(fixture.owner.token.plaintext);
  chat = q.createChatSession({ type: 'orchestration', harness: 'codex', model: 'gpt-6.1-sol', workspaceId: fixture.workspace.id, deviceId: q.getHome()!.hostDeviceId, surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: fixture.owner.member.id });
  setTeamAiRunnerForTests(async input => {
    calls.push(input);
    return new Promise(resolve => {
      gates.set(input.turn.id, resolve);
      input.signal?.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
    });
  });
});
afterEach(async () => {
  runnerState.backgroundTasks.delete(chat?.id);
  runnerState.runningSessions.delete(chat?.id);
  availability.beforeAuth = null;
  await stopTeamAiWork({}, 'Fixture ended.'); await settledTeamAi(); setTeamAiRunnerForTests(null);
  await fixture.cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
const send = (client = member, text = 'Shared request', clientSendId = crypto.randomUUID()) => client.team.ai.send.mutate({ chatId: chat.id, clientSendId, text });
const waitFor = async (count: number) => vi.waitFor(() => expect(calls).toHaveLength(count));
const finish = (id: string, outcome: TeamTurnOutcome = { status: 'done' }) => gates.get(id)!(outcome);

it('serializes two members in acceptance order, preserves author IDs, and retries once', async () => {
  const first = await send(owner, 'Owner starts', 'stable-send-first'); await waitFor(1);
  const second = await send(member, 'Maya continues', 'stable-send-next');
  expect(await send(member, 'Maya continues', 'stable-send-next')).toMatchObject({ turnId: second.turnId, created: false });
  await expect(send(member, 'Changed retry', 'stable-send-next')).rejects.toThrow(/different message/);
  expect(calls.map(call => call.memberName)).toEqual(['Owner']);
  finish(first.turnId); await waitFor(2); finish(second.turnId); await settledTeamAi();
  expect(calls.map(call => [call.memberName, call.text])).toEqual([['Owner', 'Owner starts'], ['Maya', 'Maya continues']]);
  expect(q.getChatEventById(second.messageId)?.authorMemberId).toBe(fixture.member.member.id);
  expect(q.listTeamChatTurns(chat.id).map(turn => turn.status)).toEqual(['done', 'done']);
});

it('lets a non-requesting member cancel queued messages and stop the active turn with visible reasons', async () => {
  const first = await send(owner); await waitFor(1);
  const queued = await send(owner, 'Waiting');
  await member.team.ai.stop.mutate({ turnId: queued.turnId });
  expect(q.getTeamChatTurn(queued.turnId)).toMatchObject({ status: 'cancelled', error: 'Stopped by Maya.' });
  await member.team.ai.stop.mutate({ turnId: first.turnId }); await settledTeamAi();
  expect(q.getTeamChatTurn(first.turnId)).toMatchObject({ status: 'cancelled', error: 'Stopped by Maya.' });
  expect(q.listChatEvents(chat.id, { limit: 100 }).filter(event => event.source === 'error').map(event => event.content)).toEqual(['Stopped by Maya.', 'Stopped by Maya.']);
});

it('refuses reviewer messages before acceptance on both public send paths', async () => {
  q.updateChatSession(chat.id, { surfaceKind: 'result_review' });
  await expect(send()).rejects.toThrow(/background reviewer/);
  await expect(member.sessions.messagesPost.mutate({ params: { id: chat.id }, body: { content: 'Continuation' } })).rejects.toThrow(/background reviewer/);
  expect(q.listTeamChatTurns(chat.id)).toEqual([]);
  expect(q.listChatEvents(chat.id)).toEqual([]);
});

it('preserves draft ownership and refuses unavailable selected sign-ins before recording a message', async () => {
  await expect(member.team.ai.send.mutate({ chatId: chat.id, authorMemberId: fixture.owner.member.id, text: 'Foreign draft', clientSendId: 'foreign-draft' })).rejects.toThrow(/sign-in changed/);
  availability.signedIn = false;
  await expect(send()).rejects.toThrow(/Sign in to Codex/);
  expect(q.listTeamChatTurns(chat.id)).toEqual([]);
  availability.signedIn = true;
  await send(); await waitFor(1);
});

it.each(['removed', 'off', 'archived'] as const)('revalidates an awaited availability check when authority becomes %s', async change => {
  const arrived = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  availability.beforeAuth = async () => { arrived.resolve(); await release.promise; };
  const pending = send(); await arrived.promise;
  if (change === 'removed') q.removeMember(fixture.member.member.id);
  if (change === 'off') q.saveTeamAiSettings({ enabled: false }, fixture.owner.member.id);
  if (change === 'archived') q.archiveChatSession(chat.id);
  release.resolve(); await expect(pending).rejects.toThrow();
  expect(q.listTeamChatTurns(chat.id)).toEqual([]);
});

it('shows the actual failure reason, including timeout, and admits a later retry', async () => {
  const failed = await send(); await waitFor(1);
  finish(failed.turnId, { status: 'failed', code: 'runtime', error: 'The provider timed out.' }); await settledTeamAi();
  expect(q.getTeamChatTurn(failed.turnId)).toMatchObject({ status: 'failed', error: 'The provider timed out.' });
  expect(q.listChatEvents(chat.id).some(event => event.source === 'error' && event.content === 'The provider timed out.')).toBe(true);
  await send(member, 'Try again'); await waitFor(2);
});

it('cancels all queued turns when AI is disabled, beyond the visible history page', async () => {
  const first = await send(); await waitFor(1);
  for (let i = 0; i < 210; i++) q.acceptTeamChatSend({ chatId: chat.id, memberId: fixture.member.member.id, requestingApiKeyId: fixture.member.key.id, clientSendId: `queued-${i}`, text: `Request ${i}` });
  await owner.team.ai.setEnabled.mutate({ enabled: false }); await settledTeamAi();
  expect(q.listTeamChatTurns(chat.id, { limit: 500 }).every(turn => turn.status === 'cancelled')).toBe(true);
  expect(q.getTeamChatTurn(first.turnId)?.error).toBe('Team AI was turned off.');
});

it('keeps an existing chat active when compatibility create adds another chat', async () => {
  const added = await member.team.ai.chats.create.mutate({ label: 'Additional', workspaceId: fixture.workspace.id });
  expect(q.getChatSession(chat.id)?.status).toBe('active');
  expect(q.getChatSession(added.id)).toMatchObject({ workspaceId: fixture.workspace.id, createdByMemberId: fixture.member.member.id });
});

it('keeps the last-chat rule on compatibility archive and permits another member to close a sibling', async () => {
  const execution = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'codex', label: 'Execution', surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: fixture.owner.member.id });
  await expect(member.team.ai.chats.archive.mutate({ id: execution.session.id })).rejects.toThrow(/only open chat/);
  const sibling = q.createChatSession({ executionId: execution.execution.id, workspaceId: fixture.workspace.id, type: 'execution', harness: 'codex', surfaceKind: q.TEAM_CHAT_SURFACE });
  expect(await member.team.ai.chats.archive.mutate({ id: execution.session.id })).toEqual({ ok: true });
  expect(q.getChatSession(execution.session.id)?.status).toBe('archived');
  expect(q.getChatSession(sibling.id)?.status).toBe('active'); expect(q.getExecution(execution.execution.id)?.status).toBe('active');
});

it('interrupts running turns at boot, resumes only bound queued work, and never replays done or legacy work', async () => {
  const done = q.acceptTeamChatSend({ chatId: chat.id, memberId: fixture.member.member.id, requestingApiKeyId: fixture.member.key.id, clientSendId: 'done-before-boot', text: 'Done' });
  q.claimNextTeamChatTurn(chat.id); q.finishTeamChatTurn(done.turn.id, 'done');
  const cut = q.acceptTeamChatSend({ chatId: chat.id, memberId: fixture.member.member.id, requestingApiKeyId: fixture.member.key.id, clientSendId: 'cut-before-boot', text: 'Interrupted' }); q.claimNextTeamChatTurn(chat.id);
  const queued = q.acceptTeamChatSend({ chatId: chat.id, memberId: fixture.member.member.id, requestingApiKeyId: fixture.member.key.id, clientSendId: 'waiting-before-boot', text: 'Continue bound work' });
  const legacy = q.createChatSession({ harness: 'claude', type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE });
  const old = q.acceptTeamChatSend({ chatId: legacy.id, memberId: fixture.member.member.id, clientSendId: 'legacy-before-boot', text: 'Old engine request' });
  resumeTeamAiAfterStart(); await waitFor(1);
  expect(calls[0].text).toBe('Continue bound work'); finish(queued.turn.id); await settledTeamAi();
  expect(q.getTeamChatTurn(cut.turn.id)?.status).toBe('interrupted');
  expect(q.getTeamChatTurn(old.turn.id)?.status).toBe('cancelled'); expect(q.getTeamChatTurn(done.turn.id)?.status).toBe('done');
  expect(q.listChatEvents(chat.id).some(event => event.source === 'error' && event.content?.includes('team stopped'))).toBe(true);
});

it('binds a legacy chat on its next send without inventing a creator or changing its history cursor', async () => {
  const legacy = q.createChatSession({ harness: 'claude', type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE });
  const original = q.insertChatEvent({ sessionId: legacy.id, source: 'agent', role: 'assistant', content: 'Preserved history' });
  const before = q.listTeamChatEventsLatest(legacy.id, 50);
  await member.team.ai.send.mutate({ chatId: legacy.id, clientSendId: 'legacy-next-send', text: 'Continue' }); await waitFor(1);
  expect(q.getChatSession(legacy.id)).toMatchObject({ id: legacy.id, workspaceId: fixture.workspace.id, createdByMemberId: null });
  expect(q.getChatEventById(original!.id)?.content).toBe('Preserved history');
  expect(q.listTeamChatEventsLatest(legacy.id, 50).events[0].id).toBe(before.events[0].id);
});

it('does not treat cancelled and interrupted legacy requests as current instructions', () => {
  const make = (text: string) => q.acceptTeamChatSend({ chatId: chat.id, memberId: fixture.member.member.id, requestingApiKeyId: fixture.member.key.id, clientSendId: crypto.randomUUID(), text });
  const done = make('Completed question'); q.claimNextTeamChatTurn(chat.id); q.finishTeamChatTurn(done.turn.id, 'done');
  const cancelled = make('CANCELLED INSTRUCTION'); q.finishTeamChatTurn(cancelled.turn.id, 'cancelled', 'Cancelled');
  const cut = make('INTERRUPTED INSTRUCTION'); q.finishTeamChatTurn(cut.turn.id, 'interrupted', 'Interrupted');
  q.insertChatEvent({ sessionId: chat.id, source: 'agent', role: 'assistant', content: 'PARTIAL REPLY TO INTERRUPTED REQUEST' });
  const current = make('Current request'); make('FUTURE INSTRUCTION');
  const prompt = teamAiTurnPrompt({ turn: current.turn, memberName: 'Maya', text: 'Current request' });
  expect(prompt).toContain('Completed question'); expect(prompt).not.toMatch(/CANCELLED INSTRUCTION|INTERRUPTED INSTRUCTION|FUTURE INSTRUCTION|PARTIAL REPLY/);
});

it('runs one drain loop per chat despite repeated kicks', async () => {
  const first = await send(); await waitFor(1);
  for (let i = 0; i < 10; i++) kickTeamChat(chat.id);
  expect(calls).toHaveLength(1); finish(first.turnId); await settledTeamAi(); expect(calls).toHaveLength(1);
});

it('keeps a legacy chat unbound when its selected harness is not signed in', async () => {
  const legacy = q.createChatSession({ harness: 'claude', model: 'legacy-choice', type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE });
  availability.signedIn = false;
  await expect(member.team.ai.send.mutate({ chatId: legacy.id, clientSendId: 'refused-legacy-send', text: 'Continue' })).rejects.toThrow(/Sign in/);
  expect(q.getChatSession(legacy.id)).toMatchObject({ workspaceId: null, harness: 'claude', model: legacy.model });
  expect(q.listTeamChatTurns(legacy.id)).toEqual([]);
});

it('revoking only the requesting sign-in cancels its work and preserves another member queued work', async () => {
  const first = await send(owner); await waitFor(1);
  const queued = await send(member, 'Another requester');
  await owner.team.signIns.revoke.mutate({ keyId: fixture.owner.key.id });
  await waitFor(2);
  expect(q.getTeamChatTurn(first.turnId)?.status).toBe('cancelled');
  expect(q.getTeamChatTurn(queued.turnId)?.status).toBe('running');
  finish(queued.turnId); await settledTeamAi();
});

it('keeps the next member queued while background work or a self-initiated turn is active', async () => {
  const first = await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'idle-gate-first', text: 'First' });
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  runnerState.backgroundTasks.set(chat.id, new Set(['background-work']));
  const second = await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'idle-gate-second', text: 'Second' });
  gates.get(first.turnId)!({ status: 'done' });
  await vi.waitFor(() => expect(q.getTeamChatTurn(first.turnId)?.status).toBe('done'));
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(q.getTeamChatTurn(second.turnId)?.status).toBe('queued');
  runnerState.runningSessions.add(chat.id);
  runnerState.backgroundTasks.delete(chat.id);
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(q.getTeamChatTurn(second.turnId)?.status).toBe('queued');
  runnerState.runningSessions.delete(chat.id);
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  gates.get(second.turnId)!({ status: 'done' });
  await settledTeamAi();
});

it('omits an unlabelled cancelled turn reply interleaved after a queued message', () => {
  const first = q.acceptTeamChatSend({ chatId: chat.id, memberId: fixture.owner.member.id, requestingApiKeyId: fixture.owner.key.id, clientSendId: 'late-a', text: 'Cancelled request' });
  q.claimNextTeamChatTurn(chat.id);
  const second = q.acceptTeamChatSend({ chatId: chat.id, memberId: fixture.member.member.id, requestingApiKeyId: fixture.member.key.id, clientSendId: 'late-b', text: 'Completed request' });
  q.insertChatEvent({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'Cancelled partial reply' });
  q.finishTeamChatTurn(first.turn.id, 'cancelled', 'Stopped.');
  q.claimNextTeamChatTurn(chat.id);
  q.insertChatEvent({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'Correct second reply', raw: { riTeamTurnId: second.turn.id } });
  q.finishTeamChatTurn(second.turn.id, 'done');
  const next = q.acceptTeamChatSend({ chatId: chat.id, memberId: fixture.owner.member.id, requestingApiKeyId: fixture.owner.key.id, clientSendId: 'late-c', text: 'Continue' });
  q.claimNextTeamChatTurn(chat.id);
  const prompt = teamAiTurnPrompt({ turn: next.turn, memberName: 'Owner', text: 'Continue' });
  expect(prompt).not.toContain('Cancelled partial reply');
  expect(prompt).toContain('Correct second reply');
  q.finishTeamChatTurn(next.turn.id, 'done');
});
