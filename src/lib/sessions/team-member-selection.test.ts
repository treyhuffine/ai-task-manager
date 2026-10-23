/** Review probe 4: per-member current main chats through the real routes. */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, FAKE_MODEL_ID, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { getRawDb } from '@/lib/db';
import { setHomeFolder } from '@/lib/setups/home-context';
import { settledTeamAi, stopTeamAiWork, setTeamAiRunnerForTests } from '@/lib/team/ai/chat';
import { closeAllSessions, _resetExecutorState } from '@/lib/runner/local-runner';


let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let fake: FakeHarness | undefined;
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); vi.stubGlobal('fetch', serveTeam);
  fixture = await createTeamExecutionFixture(); setTeamAiRunnerForTests(null); _resetExecutorState();
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: FAKE_MODEL_ID }, fixture.owner.member.id);
});
afterEach(async () => {
  await stopTeamAiWork({}, 'Fixture ended.'); await settledTeamAi(); await closeAllSessions(); _resetExecutorState();
  fake?.restore(); await fixture.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

async function secondAgent() {
  const cwd = path.join(fixture.home.root, 'project-2'); fs.mkdirSync(cwd);
  const ws = q.createWorkspace({ name: 'Second agent', cwd, isGit: false, createdByMemberId: fixture.owner.member.id, defaultDeviceId: q.getHome()!.hostDeviceId });
  await setHomeFolder(ws.id, cwd);
  return ws;
}
const mapOf = (memberId: string) => getRawDb().prepare('SELECT current_main_chats AS m FROM member_preferences WHERE member_id = ?').get(memberId) as { m: string } | undefined;
async function send(client: Awaited<ReturnType<typeof teamTrpc>>, chatId: string, content: string) {
  await client.sessions.messagesPost.mutate({ params: { id: chatId }, body: { content, id: crypto.randomUUID() } });
  await settledTeamAi();
}

it('crossing: two agents, two members, New and Resume stay independent', async () => {
  const w1 = fixture.workspace; const w2 = await secondAgent();
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  const member = await teamTrpc(fixture.member.token.plaintext);
  const get = async (c: typeof owner, id: string) => (await c.workspaces.chatGet.query({ params: { id } })).session?.id ?? null;
  const [o1, o2] = await Promise.all([
    owner.workspaces.chatNewPost.mutate({ params: { id: w1.id }, body: {} }),
    owner.workspaces.chatNewPost.mutate({ params: { id: w2.id }, body: {} }),
  ]);
  const [m2, m1] = await Promise.all([
    member.workspaces.chatNewPost.mutate({ params: { id: w2.id }, body: {} }),
    member.workspaces.chatNewPost.mutate({ params: { id: w1.id }, body: {} }),
  ]);
  const before = { o_w1: await get(owner, w1.id), o_w2: await get(owner, w2.id), m_w1: await get(member, w1.id), m_w2: await get(member, w2.id) };
  expect(before).toEqual({ o_w1: o1.session.id, o_w2: o2.session.id, m_w1: m1.session.id, m_w2: m2.session.id });
  // Owner resumes the member's W1 chat. Member's selections unchanged.
  await owner.workspaces.chatResumePost.mutate({ params: { id: w1.id }, body: { sessionId: m1.session.id } });
  // Cross-scope resume is refused.
  await expect(owner.workspaces.chatResumePost.mutate({ params: { id: w2.id }, body: { sessionId: m1.session.id } })).rejects.toThrow();
  const after = { o_w1: await get(owner, w1.id), o_w2: await get(owner, w2.id), m_w1: await get(member, w1.id), m_w2: await get(member, w2.id) };
  expect(after).toEqual({ o_w1: m1.session.id, o_w2: o2.session.id, m_w1: m1.session.id, m_w2: m2.session.id });
}, 60_000);

it("archive by another member: what each member falls back to and where the next message goes", async () => {
  const w1 = fixture.workspace;
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  const member = await teamTrpc(fixture.member.token.plaintext);
  const x = (await owner.workspaces.chatNewPost.mutate({ params: { id: w1.id }, body: {} })).session.id;
  await send(owner, x, 'owner hello');
  const y = (await member.workspaces.chatNewPost.mutate({ params: { id: w1.id }, body: {} })).session.id;
  await send(member, y, 'member hello');
  // Member archives owner's selected chat.
  await member.team.ai.chats.archive.mutate({ id: x });
  const ownerGet = (await owner.workspaces.chatGet.query({ params: { id: w1.id } })).session?.id ?? null;
  const memberGet = (await member.workspaces.chatGet.query({ params: { id: w1.id } })).session?.id ?? null;
  // Owner's stale tab still sends to X.
  const stale = await owner.sessions.messagesPost.mutate({ params: { id: x }, body: { content: 'owner stale', id: crypto.randomUUID() } }).then(() => 'accepted', e => `refused: ${e?.message}`);
  const yUserEvents = q.listChatEvents?.(y)?.filter?.((e: { source: string }) => e.source === 'user').map((e: { content: string | null }) => e.content);
  expect(yUserEvents).toEqual(['member hello']);
  expect(ownerGet).toBeNull();
  expect(memberGet).toBe(y);
  expect(stale.startsWith('refused')).toBe(true);
  // Member resumes X: owner (whose stored selection is still X) is pulled back to X.
  await member.workspaces.chatResumePost.mutate({ params: { id: w1.id }, body: { sessionId: x } });
  const ownerAfterResume = (await owner.workspaces.chatGet.query({ params: { id: w1.id } })).session?.id ?? null;
  const memberAfterResume = (await member.workspaces.chatGet.query({ params: { id: w1.id } })).session?.id ?? null;
  expect(ownerAfterResume).toBe(x);
  expect(memberAfterResume).toBe(x);
}, 60_000);

it('GET without a selection remains empty after another member sends', async () => {
  const w1 = fixture.workspace;
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  const member = await teamTrpc(fixture.member.token.plaintext);
  // Both open the agent: no chat yet.
  const o0 = (await owner.workspaces.chatGet.query({ params: { id: w1.id } })).session;
  const m0 = (await member.workspaces.chatGet.query({ params: { id: w1.id } })).session;
  expect(o0).toBeNull(); expect(m0).toBeNull();
  const mapBefore = mapOf(fixture.member.member.id)?.m ?? null;
  // Owner's first send (NewAgentConversation: chatNewPost then messagesPost).
  const x = (await owner.workspaces.chatNewPost.mutate({ params: { id: w1.id }, body: {} })).session.id;
  await send(owner, x, 'owner first');
  // Member refetches (window focus) -> GET.
  const m1 = (await member.workspaces.chatGet.query({ params: { id: w1.id } })).session?.id ?? null;
  const mapAfterGet = mapOf(fixture.member.member.id)?.m ?? null;
  expect(m1).toBeNull();
  expect(mapAfterGet).toBe(mapBefore);
}, 60_000);

it('malformed navigation JSON does not break preferences, reads or New', async () => {
  const member = await teamTrpc(fixture.member.token.plaintext);
  await member.workspaces.chatNewPost.mutate({ params: { id: fixture.workspace.id }, body: {} });
  for (const bad of ['not json', 'null', '[]', '"x"', JSON.stringify({ [fixture.workspace.id]: 'missing-chat-id' })]) {
    getRawDb().prepare('UPDATE member_preferences SET current_main_chats = ? WHERE member_id = ?').run(bad, fixture.member.member.id);
    expect((await member.workspaces.chatGet.query({ params: { id: fixture.workspace.id } })).session).toBeNull();
    expect(() => q.getMemberPreferences(fixture.member.member.id)).not.toThrow();
    const created = await member.workspaces.chatNewPost.mutate({ params: { id: fixture.workspace.id }, body: {} });
    expect(q.getMemberPreferences(fixture.member.member.id)?.currentMainChats[fixture.workspace.id]).toBe(created.session.id);
  }
}, 60_000);


it('New and a model change retain Ask without retiring other shared chats', async () => {
  const member = await teamTrpc(fixture.member.token.plaintext);
  const params = { id: fixture.workspace.id };
  const first = (await member.workspaces.chatNewPost.mutate({ params, body: {} })).session;
  q.updateChatSession(first.id, { permissionMode: 'ask' });
  const next = (await member.workspaces.chatNewPost.mutate({ params, body: {} })).session;
  expect(next.permissionMode).toBe('ask');
  const codex = installFakeHarness('codex'); codex.modelId = 'gpt-6.1-sol';
  try {
    const switched = (await member.workspaces.chatNewPost.mutate({ params, body: { providerId: 'codex', model: codex.modelId } })).session;
    expect(switched.permissionMode).toBe('ask');
    expect(q.getChatSession(first.id)?.status).toBe('active');
  } finally { codex.restore(); }
});
vi.mock('@/lib/harness/runtime', async original => {
 const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
 return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});


it('Resume cannot reopen a chat while archive holds its admission', async () => {
  const { closeChatAdmission } = await import('./lifecycle-admission');
  const member = await teamTrpc(fixture.member.token.plaintext);
  const params = { id: fixture.workspace.id };
  const chat = (await member.workspaces.chatNewPost.mutate({ params, body: {} })).session;
  const release = closeChatAdmission(chat.id);
  q.archiveChatSession(chat.id);
  try {
    await expect(member.workspaces.chatResumePost.mutate({ params, body: { sessionId: chat.id } })).rejects.toMatchObject({ data: { httpStatus: 409 } });
    expect(q.getChatSession(chat.id)?.status).toBe('archived');
  } finally { release(); }
});

it('Restart and Close chat report lifecycle admission collisions as conflicts', async () => {
  const { closeChatAdmission } = await import('./lifecycle-admission');
  const member = await teamTrpc(fixture.member.token.plaintext);
  const { execution, session: chat } = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, label: 'Collision', harness: 'claude', createdByMemberId: fixture.member.member.id, surfaceKind: q.TEAM_CHAT_SURFACE });
  q.createChatSession({ type: 'orchestration', executionId: execution.id, harness: 'claude', workspaceId: fixture.workspace.id, surfaceKind: q.TEAM_CHAT_SURFACE });
  const release = closeChatAdmission(chat.id);
  try {
    for (const mutation of [member.sessions.restartPost, member.sessions.closeChatPost]) {
      await expect(mutation.mutate({ params: { id: chat.id }, body: {} })).rejects.toMatchObject({ data: { httpStatus: 409 } });
    }
    expect(q.getChatSession(chat.id)?.status).toBe('active');
  } finally { release(); }
});

it('New and model changes inherit the viewed chat rather than another private selection', async () => {
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  const member = await teamTrpc(fixture.member.token.plaintext);
  const params = { id: fixture.workspace.id };
  const viewed = (await owner.workspaces.chatNewPost.mutate({ params, body: {} })).session;
  q.updateChatSession(viewed.id, { permissionMode: 'ask' });
  const withoutPointer = (await member.workspaces.chatNewPost.mutate({ params, body: { sourceChatId: viewed.id } })).session;
  expect(withoutPointer.permissionMode).toBe('ask');
  q.updateChatSession(withoutPointer.id, { permissionMode: 'auto_all' });
  const codex = installFakeHarness('codex'); codex.modelId = 'gpt-6.1-sol';
  try {
    const switched = (await member.workspaces.chatNewPost.mutate({ params, body: { sourceChatId: viewed.id, providerId: 'codex', model: codex.modelId } })).session;
    expect(switched.permissionMode).toBe('ask');
    expect(q.getMemberPreferences(fixture.owner.member.id)?.currentMainChats[params.id]).toBe(viewed.id);
    const other = await secondAgent();
    const foreign = (await owner.workspaces.chatNewPost.mutate({ params: { id: other.id }, body: {} })).session;
    const before = q.listChatSessions({ workspaceId: params.id }).length;
    await expect(member.workspaces.chatNewPost.mutate({ params, body: { sourceChatId: foreign.id } })).rejects.toMatchObject({ data: { httpStatus: 404 } });
    expect(q.listChatSessions({ workspaceId: params.id })).toHaveLength(before);
  } finally { codex.restore(); }
});

it('retains valid private selections when another map entry is malformed', async () => {
  const member = await teamTrpc(fixture.member.token.plaintext);
  const other = await secondAgent();
  const first = (await member.workspaces.chatNewPost.mutate({ params: { id: fixture.workspace.id }, body: {} })).session;
  getRawDb().prepare('UPDATE member_preferences SET current_main_chats = ? WHERE member_id = ?').run(JSON.stringify({ [fixture.workspace.id]: first.id, invalid: 7 }), fixture.member.member.id);
  const before = mapOf(fixture.member.member.id)!.m;
  expect((await member.workspaces.chatGet.query({ params: { id: fixture.workspace.id } })).session?.id).toBe(first.id);
  expect(mapOf(fixture.member.member.id)!.m).toBe(before);
  const next = (await member.workspaces.chatNewPost.mutate({ params: { id: other.id }, body: {} })).session;
  expect(q.getMemberPreferences(fixture.member.member.id)?.currentMainChats).toEqual({ [fixture.workspace.id]: first.id, [other.id]: next.id });
});

it('refuses Resume during an actual asynchronous chat archive and keeps the prior selection', async () => {
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  const member = await teamTrpc(fixture.member.token.plaintext);
  const params = { id: fixture.workspace.id };
  const chat = (await member.workspaces.chatNewPost.mutate({ params, body: {} })).session;
  await send(member, chat.id, 'Start');
  const previous = (await owner.workspaces.chatNewPost.mutate({ params, body: {} })).session;
  const entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  const original = fake!.latest().close.bind(fake!.latest());
  vi.spyOn(fake!.latest(), 'close').mockImplementation(async () => { entered.resolve(); await finish.promise; await original(); });
  const archive = member.team.ai.chats.archive.mutate({ id: chat.id });
  try {
    await entered.promise;
    expect(q.getChatSession(chat.id)?.status).toBe('active');
    await expect(owner.workspaces.chatResumePost.mutate({ params, body: { sessionId: chat.id } })).rejects.toMatchObject({ data: { httpStatus: 409 } });
    expect(q.getMemberPreferences(fixture.owner.member.id)?.currentMainChats[params.id]).toBe(previous.id);
  } finally { finish.resolve(); await archive; }
  expect(q.getChatSession(chat.id)?.status).toBe('archived');
});
