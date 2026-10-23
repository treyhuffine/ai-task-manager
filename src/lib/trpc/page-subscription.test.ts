import { WebSocket } from 'ws';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { startHomeServer } from '@/test/fixtures/home-server';
import { ApiClient } from '@/lib/api/client';
import { createAppTRPCClient } from './client';
import * as q from '@/lib/db/queries';
import { publishDeviceUpdated, publishRuntime } from '@/lib/realtime/bus';
import type { PageFrame } from '@/lib/realtime/page-feed';
import { pageFrames, pageSubscriptionInput } from './page-subscription';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let server: Awaited<ReturnType<typeof startHomeServer>>;
let client: ReturnType<typeof createAppTRPCClient>;
let chat: string;
const frames: PageFrame[] = [];
const errors: unknown[] = [];
const subscriptions: Array<{ unsubscribe(): void }> = [];
async function until(check: () => boolean) {
  for (let i = 0; i < 400; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('The authorized page stream did not reach its expected state.');
}
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); fixture = await createTeamExecutionFixture();
  server = await startHomeServer({ websocket: true }); frames.length = 0; errors.length = 0;
  client = createAppTRPCClient({ url: server.url + '/api/trpc', WebSocket: WebSocket as unknown as typeof globalThis.WebSocket, websocketOnly: true, transport: new ApiClient({ getToken: () => fixture.member.token.plaintext, onUnauthorized() {} }) });
  const created = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'codex', model: 'gpt-6.1-sol', label: 'Shared project', surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: fixture.member.member.id });
  q.createPlacement({ executionId: created.execution.id, deviceId: q.getHome()!.hostDeviceId, startReason: 'created', worktreePath: '/work/project' });
  chat = created.session.id;
});
afterEach(async () => { subscriptions.splice(0).forEach(subscription => subscription.unsubscribe()); await client?.closeTransport(); await server?.close(); await fixture.cleanup(); vi.unstubAllEnvs(); });
function follow(after: string | null = null, chatId = chat) {
  const subscription = client.live.output.subscribe({ s: [[chatId, after, null]], t: [] }, { onData: frame => frames.push({ event: frame.event, data: frame.data }), onError: error => errors.push(error) });
  subscriptions.push(subscription); return subscription;
}

it('streams ordinary native events and replay cursors over the real member socket while excluding unrelated Home signals', async () => {
  const first = q.insertChatEvent({ sessionId: chat, role: 'user', source: 'user', content: 'First', authorMemberId: fixture.member.member.id })!;
  const missed = q.insertChatEvent({ sessionId: chat, role: 'assistant', source: 'text', content: 'Missed reply' })!;
  const subscription = follow(first.id);
  await until(() => frames.some(frame => frame.event === 'ready'));
  expect(frames).toContainEqual(expect.objectContaining({ event: 'session', data: expect.objectContaining({ s: chat, e: 'chat_event', i: missed.id, d: expect.objectContaining({ content: 'Missed reply' }) }) }));
  const unrelated = q.createChatSession({ harness: 'codex', type: 'orchestration', surfaceKind: 'private-skill' });
  publishRuntime(unrelated.id, true); publishDeviceUpdated(q.getHome()!.hostDeviceId!);
  publishRuntime(chat, true); publishDeviceUpdated(q.getHome()!.hostDeviceId);
  const live = q.insertChatEvent({ sessionId: chat, role: 'user', source: 'user', content: 'Live member message', authorMemberId: fixture.member.member.id })!;
  await until(() => frames.some(frame => JSON.stringify(frame).includes(live.id)));
  expect(JSON.stringify(frames)).not.toContain(unrelated.id);
  expect(JSON.stringify(frames)).not.toContain(unrelated.id);
  expect(frames).toContainEqual({ event: 'device_updated', data: { kind: 'device_updated', deviceId: q.getHome()!.hostDeviceId } });
  expect(frames).toContainEqual(expect.objectContaining({ event: 'session', data: expect.objectContaining({ i: live.id, d: expect.objectContaining({ authorMemberId: fixture.member.member.id }) }) }));
  subscription.unsubscribe();
  expect(errors).toEqual([]);
});

it('closes an idle authorized subscription when membership is removed and refuses unrelated chat identity', async () => {
  const unrelated = q.createChatSession({ harness: 'codex', type: 'orchestration', surfaceKind: 'private-skill' });
  const refused: unknown[] = [];
  subscriptions.push(client.live.output.subscribe({ s: [[unrelated.id, null, null]], t: [] }, { onError: error => refused.push(error) }));
  await until(() => refused.length > 0);
  expect(refused[0]).toMatchObject({ data: { code: 'FORBIDDEN' } });
  follow(); await until(() => frames.some(frame => frame.event === 'ready'));
  q.removeMember(fixture.member.member.id);
  await until(() => errors.length > 0);
  const count = frames.length;
  q.insertChatEvent({ sessionId: chat, role: 'assistant', source: 'text', content: 'After revocation' });
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(frames).toHaveLength(count);
});

it('preserves the restricted legacy projection in both common snapshots and live replay', async () => {
  const legacy = q.createChatSession({ harness: 'claude', type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE, label: 'Retained conversation' });
  const first = q.insertChatEvent({ sessionId: legacy.id, role: 'user', source: 'user', content: 'Existing member request', authorMemberId: fixture.member.member.id })!;
  q.insertChatEvent({ sessionId: legacy.id, role: 'system', source: 'system', content: 'host-observation-canary', raw: { model: 'host-observation-canary' } });
  q.insertChatEvent({ sessionId: legacy.id, role: 'assistant', source: 'agent', content: 'Retained answer', raw: { subtype: 'host-observation-canary', model: 'host-observation-canary', usage: { note: 'host-observation-canary' } } });
  const snapshot = await client.sessions.eventsGet.query({ params: { id: legacy.id } });
  expect(snapshot.map(event => event.content)).toEqual(['Existing member request', 'Retained answer']);
  expect(JSON.stringify(snapshot)).not.toContain('host-observation-canary');
  follow(first.id, legacy.id); await until(() => frames.some(frame => frame.event === 'ready'));
  expect(JSON.stringify(frames)).toContain('Retained answer');
  expect(JSON.stringify(frames)).not.toContain('host-observation-canary');
});

it('bounds subscriptions and refuses a forged role without a live sign-in before opening feeds', async () => {
  expect(pageSubscriptionInput.safeParse({ s: Array.from({ length: 33 }, () => [chat, null, null]), t: [] }).success).toBe(false);
  expect(pageSubscriptionInput.safeParse({ s: [], t: [['/home/../../private', 't', null]] }).success).toBe(false);
  const key = { ...fixture.actor, apiKeyId: 'forged-key', scope: 'member' as const, memberRole: 'owner' as const, location: 'elsewhere' as const, workerDeviceId: null, sessionChatId: null };
  await expect(pageFrames({ s: [[chat, null, null]], t: [] }, { key }).next()).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('ends a slow consumer before its page feed can grow without a bound', async () => {
  const key = { ...fixture.actor, scope: 'member' as const, location: 'elsewhere' as const, workerDeviceId: null, sessionChatId: null };
  const stream = pageFrames({ s: [[chat, null, null]], t: [] }, { key });
  await stream.next();
  for (let i = 0; i < 260; i++) publishRuntime(chat, true);
  await expect(stream.next()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  await stream.return();
});
