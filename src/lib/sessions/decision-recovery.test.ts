/** Review 10: connection decision note delivery through the real wakeAgent -> dispatchSessionTurn -> runner path, fake provider. */
import type { AgentSession } from '@agentex/agent';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { ensureHomeIdentity, resetHomeIdentityCache } from '@/lib/home/identity';
import * as q from '@/lib/db/queries';
import * as executor from '@/lib/executor/adapter';
import { declineCard } from '@/lib/integrations/connection-requests';
import type { ConnectionRequestView } from '@/lib/integrations/connection-catalog';


let home: TestHome, fake: FakeHarness;
beforeEach(async () => { vi.stubEnv('RI_MIRROR_DISABLED', '1'); home = await createTestHome({ prefix: 'ri-r10-note-' }); resetHomeIdentityCache(); ensureHomeIdentity(); executor._resetExecutorState(); fake = installFakeHarness('claude'); });
afterEach(async () => { vi.restoreAllMocks(); await (await import('@/lib/runner/local-runner')).closeAllSessions().catch(() => {}); fake.restore(); executor._resetExecutorState(); resetHomeIdentityCache(); await home.cleanup(); vi.unstubAllEnvs(); }, 30_000);
function connectionCard(sessionId: string) {
  const view: ConnectionRequestView = { kind: 'connect', providerId: 'google', providerName: 'Google', label: 'Gmail', toolkitIds: ['gmail'],
    method: 'oauth2', credentialFields: [], reason: 'Read a message', requestedBy: 'agent', agent: null, onBehalf: false,
    connectionId: null, account: null, scopes: null, authConfigId: null };
  return q.insertChatEvent({ sessionId, role: 'system', source: 'connection_request', content: 'Connect Gmail', toolInput: view })!;
}
const systemNotes = (id: string) => q.listChatEvents(id).filter(e => (e.raw as {agentCoordination?: {senderKind?: string}} | null)?.agentCoordination?.senderKind === 'system').map(e => e.content ?? '');
const delivered = () => fake.sessions.flatMap(s => s.messages).filter(m => m.includes('chose not to connect')).length;

it('does not preserve an undelivered note after native acceptance followed by provider failure', async () => {
  fake.onTurn(async turn => { if (turn.message.includes('chose not to connect')) throw new Error('Provider failed mid-turn after reading the note'); await turn.say('ok'); });
  const chat = q.createChatSession({ harness: 'claude', model: fake.modelId, type: 'content' });
  const card = connectionCard(chat.id);
  await declineCard(card.id);
  await vi.waitFor(() => expect(delivered()).toBe(1), { timeout: 10_000 });
  await vi.waitFor(() => expect(executor.isRunning(chat.id)).toBe(false), { timeout: 10_000 });
  await new Promise(r => setTimeout(r, 300));
  expect(systemNotes(chat.id)).toEqual([]);
  expect(q.pendingAgentDeliveries(chat.id)).toEqual([]);
}, 30_000);

it('does not preserve an undelivered note after native acceptance followed by Stop', async () => {
  const entered = Promise.withResolvers<void>();
  fake.onTurn(async turn => { if (turn.message.includes('chose not to connect')) { entered.resolve(); await new Promise((_, reject) => turn.signal.addEventListener('abort', () => reject(new Error('aborted')))); } else await turn.say('ok'); });
  const chat = q.createChatSession({ harness: 'claude', model: fake.modelId, type: 'content' });
  await declineCard(connectionCard(chat.id).id);
  await entered.promise;
  await executor.abort(chat.id);
  await vi.waitFor(() => expect(executor.isRunning(chat.id)).toBe(false), { timeout: 10_000 });
  await new Promise(r => setTimeout(r, 300));
  expect(systemNotes(chat.id)).toEqual([]);
  expect(q.pendingAgentDeliveries(chat.id)).toEqual([]);
}, 30_000);

it('supplies a blocked decision once beside the first human turn after recovery', async () => {
  const chat = q.createChatSession({ harness: 'claude', model: fake.modelId, type: 'content' });
  const close = vi.fn(async () => { throw new Error('Shutdown failed'); });
  const sendMessage = vi.fn(); executor._cacheHarnessSession(chat.id, { close, send: sendMessage } as unknown as AgentSession);
  expect(await executor.close(chat.id)).toMatchObject({ closed: false });
  await declineCard(connectionCard(chat.id).id);
  await vi.waitFor(() => expect(systemNotes(chat.id).length).toBe(1));
  close.mockResolvedValueOnce(undefined as never);
  expect(await executor.close(chat.id)).toMatchObject({ closed: true });
  const event = q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'Continue please', createdAt: new Date().toISOString() })!;
  await executor.dispatch(chat.id, event.content!, { sourceEventId: event.id, actor: { source: 'human' } });
  expect(delivered()).toBe(1);
  expect(q.pendingAgentDeliveries(chat.id)).toHaveLength(0);
  await executor.dispatch(chat.id, 'One more message', { actor: { source: 'human' } });
  expect(delivered()).toBe(1);
  expect(sendMessage).not.toHaveBeenCalled();
}, 30_000);

it('preserves approval decisions while shutdown is unconfirmed without automatically dispatching them', async () => {
  const chat = q.createChatSession({ harness: 'claude', model: fake.modelId, type: 'content' });
  const close = vi.fn(async () => { throw new Error('Shutdown failed'); });
  const sendMessage = vi.fn(); executor._cacheHarnessSession(chat.id, { close, send: sendMessage } as unknown as AgentSession);
  expect(await executor.close(chat.id)).toMatchObject({ closed: false });
  const { recordApprovalDecision } = await import('@/lib/integrations/approval-events');
  const errors: unknown[] = []; const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.map(String).join(' ')); });
  await recordApprovalDecision([{ id: 'appr-1', ownerId: 'local', actionId: 'GMAIL_SEND_EMAIL', connectionId: 'conn-1', providerId: 'google', account: 'me@example.invalid', risk: 'high', preview: { to: 'x@example.invalid' }, sessionId: chat.id, createdAt: Date.now(), decision: 'approve' }], 'approve');
  await new Promise(r => setTimeout(r, 500)); spy.mockRestore();
  expect(q.pendingAgentDeliveries(chat.id)).toEqual([expect.objectContaining({ payload: expect.objectContaining({ contextOnly: true, content: expect.stringContaining('approved') }) })]);
  expect(q.dueAgentDeliveries()).toHaveLength(0);
  expect(sendMessage).not.toHaveBeenCalled();
}, 30_000);

it('quarantined personal health checks do not replay or claim an unknown send was refused', async () => {
  const chat = q.createChatSession({ harness: 'claude', model: fake.modelId, type: 'execution' });
  const event = q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'Possibly still running' })!;
  const state = (await import('@/lib/runner/live-state')).runnerState;
  state.unconfirmedCloses.add(chat.id);
  const before = q.listChatEvents(chat.id);
  const report = await (await import('@/lib/executor/health')).healthCheckSession(chat.id, { force: true });
  expect(report).toMatchObject({ classification: 'ambiguous', redispatched: false, replayed: 0 });
  expect(q.listChatEvents(chat.id)).toEqual(before);
  expect(q.getChatEventById(event.id)?.content).toBe('Possibly still running');
  expect(fake.sessions).toHaveLength(0);
  state.unconfirmedCloses.delete(chat.id);
});

it('a human resending a complete saved decision consumes its receipt without duplicating the context', async () => {
  const chat = q.createChatSession({ harness: 'claude', model: fake.modelId, type: 'content' });
  const note = 'The user chose not to connect Gmail for now.';
  q.preserveSystemContext(chat.id, 'decision-resend', note);
  await executor.dispatch(chat.id, `Continue with this decision: ${note}`, { actor: { source: 'human' } });
  expect(fake.latest().messages[0].split(note)).toHaveLength(2);
  expect(q.pendingAgentDeliveries(chat.id)).toHaveLength(0);
  await executor.dispatch(chat.id, 'Continue again', { actor: { source: 'human' } });
  expect(fake.latest().messages[1]).not.toContain(note);
});
