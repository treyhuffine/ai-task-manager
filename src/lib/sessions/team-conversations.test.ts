import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { closeAllSessions, _resetExecutorState } from '@/lib/runner/local-runner';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import * as q from '@/lib/db/queries';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import { stopTeamAiWork, settledTeamAi } from '@/lib/team/ai/chat';
import { API_PROTOCOL, API_PROTOCOL_HEADER } from '@/lib/releases/api-contract';

let fake: FakeHarness;
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let member: Awaited<ReturnType<typeof teamTrpc>>;
let owner: Awaited<ReturnType<typeof teamTrpc>>;
let session: ReturnType<typeof q.createExecutionWithChat>['session'];
beforeAll(preloadTeamRoutes);
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); vi.stubGlobal('fetch', serveTeam);
  fixture = await createTeamExecutionFixture(); fake = installFakeHarness('codex'); fake.modelId = 'gpt-6.1-sol';
  member = await teamTrpc(fixture.member.token.plaintext); owner = await teamTrpc(fixture.owner.token.plaintext);
  const created = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, createdByMemberId: fixture.owner.member.id, surfaceKind: q.TEAM_CHAT_SURFACE, harness: 'codex', label: 'Shared project', model: 'gpt-6.1-sol' });
  q.createPlacement({ executionId: created.execution.id, deviceId: q.getHome()!.hostDeviceId, startReason: 'created', worktreePath: fixture.workspace.cwd });
  session = created.session;
  vi.clearAllMocks();
});
afterEach(async () => { await stopTeamAiWork({}, 'Fixture finished.'); await settledTeamAi(); await closeAllSessions(); _resetExecutorState(); fake.restore(); await fixture.cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const params = () => ({ id: session.id });
const headers = () => ({ authorization: `Bearer ${fixture.member.token.plaintext}`, [API_PROTOCOL_HEADER]: String(API_PROTOCOL), 'content-type': 'application/json' });

it('creates ordinary sibling conversations with the original execution destination and individual creator identity', async () => {
  const result = await member.sessions.newChatPost.mutate({ params: params(), body: {} });
  expect(result.session).toMatchObject({ executionId: session.executionId, workspaceId: session.workspaceId, createdByMemberId: fixture.member.member.id, harness: 'codex', model: 'gpt-6.1-sol', surfaceKind: q.TEAM_CHAT_SURFACE });
  expect(q.chatPlacement(result.session.id)?.deviceId).toBe(q.getHome()!.hostDeviceId);
  expect(q.getChatSession(session.id)).not.toBeNull();
  const history = await member.sessions.historyGet.query({ params: params() });
  expect(history.sessions.map(chat => chat.id)).toEqual(expect.arrayContaining([session.id, result.session.id]));
  await expect(member.sessions.newChatPost.mutate({ params: params(), body: { model: 'private-host-model' } })).rejects.toThrow();

  q.saveTeamAiSettings({ enabled: false }, fixture.owner.member.id);
  expect((await member.sessions.historyGet.query({ params: params() })).sessions).toHaveLength(2);
  await expect(member.sessions.newChatPost.mutate({ params: params(), body: {} })).rejects.toThrow(/Team AI is off/);
});

it('allows another member to close accepted work and preserves shared history', async () => {
  const sibling = await member.sessions.newChatPost.mutate({ params: params(), body: {} });
  const accepted = q.acceptTeamChatSend({ chatId: session.id, memberId: fixture.owner.member.id, requestingApiKeyId: fixture.owner.key.id, clientSendId: 'owner-work', text: 'Keep this accepted request' });
  expect(await member.sessions.closeChatPost.mutate({ params: params(), body: {} })).toEqual({ ok: true });
  expect(q.getChatSession(session.id)?.status).toBe('archived');
  expect(q.getChatSession(sibling.session.id)?.status).toBe('active');
  expect(q.getTeamChatTurn(accepted.turn.id)?.status).toBe('cancelled');
  expect(q.getChatEventById(accepted.message.id)?.authorMemberId).toBe(fixture.owner.member.id);
});

it('shares bounded content references and catalog reads without exposing an unconfigured host agent', async () => {
  const task = q.createTask({ title: 'Shared task' });
  const note = q.createNote({ title: 'Shared note', body: 'Team context' });
  await member.sessions.referencesPost.mutate({ params: params(), body: { entityType: 'task', entityId: task.id } });
  await member.sessions.referencesPost.mutate({ params: params(), body: { entityType: 'note', entityId: note.id } });
  expect(await member.sessions.entitiesGet.query({ params: params() })).toMatchObject({ tasks: [{ id: task.id }], notes: [{ id: note.id }] });
  expect((await member.sessions.pickerGet.query({ params: params() })).tasks.map(row => row.id)).toContain(task.id);
  expect((await member.sessions.referencesGet.query({ params: params() })).rows.map(row => row.id)).toEqual(expect.arrayContaining([task.id, note.id]));
  const host = q.createWorkspace({ name: 'Unconfigured host', cwd: '/private/host', isGit: false });
  const privateChat = q.createExecutionWithChat({ workspaceId: host.id, harness: 'codex', label: 'Hidden host chat' }).session;
  expect((await member.sessions.historyList.query({})).sessions.map(chat => chat.id)).not.toContain(privateChat.id);
  expect((await member.sessions.searchGet.query({ query: { q: 'Hidden host chat' } })).map(chat => chat.id)).not.toContain(privateChat.id);
  await expect(member.sessions.pickerGet.query({ params: { id: privateChat.id } })).rejects.toMatchObject({ data: { httpStatus: 403 } });
  const raw = await serveTeam(`http://team.test/api/sessions/${session.id}/entities`, { headers: headers() });
  expect(raw.status).toBe(200);
  q.revokeApiKey(fixture.member.key.id, 'Signed out');
  await expect(member.sessions.historyGet.query({ params: params() })).rejects.toThrow(/401/);
  expect((await serveTeam(`http://team.test/api/sessions/${session.id}/entities`, { headers: headers() })).status).toBe(401);
});

it('keeps read markers and execution pins independent for each member across detail, rail and history', async () => {
  const first = await member.sessions.readPost.mutate({ params: params(), body: {} });
  expect(first.lastViewedAt).toBeTruthy();
  expect(q.getChatSession(session.id)?.lastViewedAt).toBeNull();
  expect((await owner.sessions.get.query({ params: params() })).lastViewedAt).toBeNull();
  const unread = await member.sessions.unreadPost.mutate({ params: params(), body: {} });
  expect(unread.unreadMarkerAt! > unread.lastViewedAt!).toBe(true);
  expect((await owner.sessions.historyGet.query({ params: params() })).sessions[0].unreadMarkerAt).toBeNull();
  const pinned = await member.sessions.pinPost.mutate({ params: params(), body: {} });
  expect(pinned.execution?.pinnedAt).toBeTruthy();
  expect(q.getExecution(session.executionId!)?.pinnedAt).toBeNull();
  expect((await owner.sessions.get.query({ params: params() })).execution?.pinnedAt).toBeNull();
  expect((await member.sessions.railGet.query({})).sessions.find(row => row.id === session.id)?.execution?.pinnedAt).toBeTruthy();
  expect((await owner.sessions.railGet.query({})).sessions.find(row => row.id === session.id)?.execution?.pinnedAt).toBeNull();
  q.archiveExecution(session.executionId!); q.unarchiveExecution(session.executionId!);
  expect((await member.sessions.get.query({ params: params() })).execution?.pinnedAt).toBeNull();
  expect((await serveTeam(`http://team.test/api/sessions/${session.id}/read`, { method: 'POST', headers: headers(), body: '{}' })).status).toBe(200);
});

it('shares the scratchpad and journal-backed health check without running a Home harness or replaying member sends', async () => {
  await member.sessions.scratchpadPut.mutate({ params: params(), body: { scratchPad: 'Shared execution context' } });
  expect(await owner.sessions.scratchpadGet.query({ params: params() })).toEqual({ scratchPad: 'Shared execution context' });
  expect(await member.sessions.reconcilePost.mutate({ params: params(), body: {} })).toMatchObject({ drift: false, replayed: 0, redispatched: false });

  q.removeMember(fixture.member.member.id);
  await expect(member.sessions.readPost.mutate({ params: params(), body: {} })).rejects.toThrow(/401/);
  expect((await serveTeam(`http://team.test/api/sessions/${session.id}/scratchpad`, { headers: headers() })).status).toBe(401);
});
