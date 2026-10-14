/**
 * Team AI's settings and shared chats (docs/homes-spec.md §9.9, P8.4-P8.5),
 * through the real proxy and tRPC, with a stand-in for the runtime so turns
 * can be held, released and stopped: who may configure it, one turn at a time
 * in accepted order with each sender's identity, retries that never make a
 * second turn, reconnecting by cursor, and what turning it off, removing a
 * member, a restart or a refused key leave behind.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiErrorStatus } from '@/lib/api/error-status';
import { createTeamTestHome, preloadTeamRoutes, serveTeam, teamTrpc, type TeamTestHome } from '@/test/fixtures/team-home';
import type { RunTeamTurnInput, TeamTurnOutcome } from './runtime';

const ai = vi.hoisted(() => ({
  embed: vi.fn(async () => ({ embedding: new Array(1536).fill(0) })),
  harness: vi.fn(async () => { throw new Error('no background model in a team'); }),
}));
vi.mock('ai', async (importOriginal) => ({ ...(await importOriginal<typeof import('ai')>()), embed: ai.embed }));
vi.mock('@/lib/harness/one-shot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/harness/one-shot')>()),
  runHarnessText: ai.harness,
  runHarnessJson: ai.harness,
}));
vi.mock('./probe', () => ({ probeTeamAiRuntime: vi.fn(async () => ({ ok: true, version: '2.1.295 (Claude Code)', missing: [], error: null })) }));
vi.mock('@/lib/sessions/workstream', () => ({ coordinateLifecycleChange: vi.fn(async () => {}) }));
vi.mock('@/lib/sessions/workstream-runtime', () => ({ inProcessWorkstreamRuntime: {} }));
vi.mock('@/lib/executor/status-snapshot', () => ({ listRunningSessions: () => [] }));
vi.setConfig({ testTimeout: 60_000 });

/** A runtime that answers when told to, records who asked, and stops when stopped. */
function heldRuntime() {
  const calls: Array<{ turnId: string; member: string; text: string }> = [];
  const gates = new Map<string, (outcome: TeamTurnOutcome) => void>();
  let active = 0;
  let overlapped = false;
  const runner = async (input: RunTeamTurnInput): Promise<TeamTurnOutcome> => {
    active += 1;
    if (active > 1) overlapped = true;
    calls.push({ turnId: input.turn.id, member: input.memberName, text: input.text });
    try {
      return await new Promise<TeamTurnOutcome>((resolve) => {
        gates.set(input.turn.id, resolve);
        input.signal?.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
      });
    } finally {
      active -= 1;
    }
  };
  return {
    runner,
    calls,
    overlapped: () => overlapped,
    async answer(turnId: string, text: string, outcome: TeamTurnOutcome = { status: 'done' }) {
      const q = await import('@/lib/db/queries');
      const turn = q.getTeamChatTurn(turnId)!;
      q.insertChatEvent({ sessionId: turn.chatSessionId, role: 'assistant', source: 'agent', content: text, createdAt: new Date().toISOString() });
      gates.get(turnId)?.(outcome);
    },
    async waitFor(count: number) {
      for (let i = 0; i < 200 && calls.length < count; i++) await new Promise((r) => setTimeout(r, 10));
      expect(calls.length).toBeGreaterThanOrEqual(count);
    },
  };
}

let team: TeamTestHome;
let maya: { token: string; id: string };
let held: ReturnType<typeof heldRuntime>;

beforeAll(preloadTeamRoutes, 120_000);

beforeEach(async () => {
  vi.stubGlobal('fetch', serveTeam);
  team = await createTeamTestHome('ri-team-chat-');
  maya = await team.joinAs('Maya');
  held = heldRuntime();
  const { setTeamAiTestSeams } = await import('./chat');
  setTeamAiTestSeams(null, held.runner);
});

afterEach(async () => {
  const { setTeamAiTestSeams, settledTeamAi, stopTeamAiWork } = await import('./chat');
  await stopTeamAiWork({}, 'test over');
  await settledTeamAi();
  setTeamAiTestSeams(null, null);
  vi.unstubAllGlobals();
  await team.cleanup();
});

async function status(promise: Promise<unknown>): Promise<number | null> {
  try {
    await promise;
    return 200;
  } catch (err) {
    return apiErrorStatus(err) ?? null;
  }
}

async function turnOn() {
  const owner = await teamTrpc(team.owner.token);
  await owner.team.ai.configure.mutate({ apiKey: 'sk-ant-team', credentialLabel: "Acme's Anthropic account" });
  return owner.team.ai.setEnabled.mutate({ enabled: true });
}

const sendId = () => crypto.randomUUID();

describe('Team AI settings', () => {
  it('keeps a refused key unavailable when another chat finishes successfully', async () => {
    await turnOn();
    const owner = await teamTrpc(team.owner.token);
    const [main] = await owner.team.ai.chats.list.query();
    const other = await owner.team.ai.chats.create.mutate({ label: 'Other conversation' });
    const a = await owner.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'First' });
    const b = await owner.team.ai.send.mutate({ chatId: other.id, clientSendId: sendId(), text: 'Second' });
    await held.waitFor(2);
    await held.answer(a.turnId, '', { status: 'failed', code: 'credential_rejected', error: 'Refused' });
    await vi.waitFor(async () => expect(await owner.team.ai.status.query()).toMatchObject({ state: 'unavailable' }));
    await held.answer(b.turnId, 'Finished before the key was revoked');
    const { settledTeamAi } = await import('./chat');
    await settledTeamAi();
    expect(await owner.team.ai.status.query()).toMatchObject({ state: 'unavailable', reason: expect.stringMatching(/refused/) });
  });

  it('does not reject a replacement key when an old turn reports its refusal', async () => {
    await turnOn();
    const owner = await teamTrpc(team.owner.token);
    const [main] = await owner.team.ai.chats.list.query();
    const sent = await owner.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'Old key' });
    await held.waitFor(1);
    await owner.team.ai.configure.mutate({ apiKey: 'sk-ant-replacement', credentialLabel: 'New account' });
    await held.answer(sent.turnId, '', { status: 'failed', code: 'credential_rejected', error: 'Old key refused' });
    const { settledTeamAi } = await import('./chat');
    await settledTeamAi();
    expect(await owner.team.ai.status.query()).toMatchObject({ state: 'ready' });
  });

  it('is off by default, set up by the owner only, and never shows its key', async () => {
    const owner = await teamTrpc(team.owner.token);
    const member = await teamTrpc(maya.token);
    expect(await member.team.ai.status.query()).toMatchObject({ enabled: false, state: 'off' });
    expect(await status(member.team.ai.configure.mutate({ apiKey: 'sk-ant-x', credentialLabel: 'Mine' }))).toBe(403);
    expect(await status(member.team.ai.setEnabled.mutate({ enabled: true }))).toBe(403);

    expect(await owner.team.ai.setEnabled.mutate({ enabled: true })).toMatchObject({ state: 'needs_key' });
    const ready = await owner.team.ai.configure.mutate({ apiKey: 'sk-ant-secret-team-key', credentialLabel: "Acme's Anthropic account" });
    expect(ready).toMatchObject({ enabled: true, state: 'ready', credentialLabel: "Acme's Anthropic account", provider: 'Anthropic API', runtime: 'Claude Code' });
    expect(JSON.stringify(ready)).not.toContain('sk-ant-secret');
    expect(JSON.stringify(await member.team.ai.status.query())).not.toContain('sk-ant-secret');
    // Turning it on made the team's main chat.
    const chats = await member.team.ai.chats.list.query();
    expect(chats).toEqual([expect.objectContaining({ main: true, label: 'Acme' })]);
    expect(await status(member.team.ai.chats.archive.mutate({ id: chats[0].id }))).toBe(400);
  });

  it('refuses to answer while off, keeping history readable', async () => {
    await turnOn();
    const member = await teamTrpc(maya.token);
    const [main] = await member.team.ai.chats.list.query();
    await member.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'Hello' });
    await held.waitFor(1);
    await held.answer(held.calls[0].turnId, 'Hi Maya.');
    const { settledTeamAi } = await import('./chat');
    await settledTeamAi();

    await (await teamTrpc(team.owner.token)).team.ai.setEnabled.mutate({ enabled: false });
    expect(await status(member.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'Still there?' }))).toBe(412);
    const page = await member.team.ai.events.query({ chatId: main.id });
    expect(page.events.map((e) => e.content)).toEqual(expect.arrayContaining(['Hello', 'Hi Maya.']));
    expect(held.calls).toHaveLength(1);
    expect(ai.harness).not.toHaveBeenCalled();
  });
});

describe('shared chats', () => {
  it('settles every queued turn when the provider becomes unavailable, beyond the display page', async () => {
    await turnOn();
    const q = await import('@/lib/db/queries');
    const chat = q.createTeamChat('Long queue');
    for (let i = 0; i < 205; i++) {
      q.acceptTeamChatSend({ chatId: chat.id, memberId: maya.id, clientSendId: sendId(), text: `Waiting ${i}` });
    }
    q.saveTeamAiSettings({ lastError: 'credential_rejected' }, null);
    const { kickTeamChat, settledTeamAi } = await import('./chat');
    kickTeamChat(chat.id);
    await settledTeamAi();
    const turns = q.listTeamChatTurns(chat.id, { limit: 300 });
    expect(turns).toHaveLength(205);
    expect(turns.every((turn) => turn.status === 'failed')).toBe(true);
    expect(q.teamChatsWithQueuedTurns()).toEqual([]);
  });

  it.each(['member removed', 'chat archived', 'AI disabled', 'key removed'] as const)('rechecks a pending send after its runtime probe: %s', async (change) => {
    await turnOn();
    const owner = await teamTrpc(team.owner.token);
    const member = await teamTrpc(maya.token);
    const [main] = await member.team.ai.chats.list.query();
    const chat = change === 'chat archived' ? await member.team.ai.chats.create.mutate({ label: 'Temporary' }) : main;
    const { probeTeamAiRuntime } = await import('./probe');
    let release!: () => void;
    vi.mocked(probeTeamAiRuntime).mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ ok: true, version: 'test', missing: [], error: null });
    }));
    const sending = status(member.team.ai.send.mutate({ chatId: chat.id, clientSendId: sendId(), text: 'Never accepted' }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (change === 'member removed') await owner.team.removeMember.mutate({ id: maya.id });
    if (change === 'chat archived') await owner.team.ai.chats.archive.mutate({ id: chat.id });
    if (change === 'AI disabled') await owner.team.ai.setEnabled.mutate({ enabled: false });
    if (change === 'key removed') await owner.team.ai.forgetKey.mutate();
    release();
    expect(await sending).toBe(change === 'member removed' ? 403 : change === 'chat archived' ? 404 : 412);
    const q = await import('@/lib/db/queries');
    expect(q.listTeamChatTurns(chat.id)).toEqual([]);
    expect(q.listTeamChatEventsLatest(chat.id).events).toEqual([]);
    expect(held.calls).toEqual([]);
  });

  it('runs one turn at a time in the order sent, each as its sender, and shows who wrote what', async () => {
    await turnOn();
    const trey = await teamTrpc(team.owner.token);
    const member = await teamTrpc(maya.token);
    const [main] = await member.team.ai.chats.list.query();
    const [a, b] = await Promise.all([
      member.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'What did we decide about billing?' }),
      trey.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'And when do we release?' }),
    ]);
    await held.waitFor(1);
    let page = await member.team.ai.events.query({ chatId: main.id });
    // One running, one waiting behind it, in the order they were accepted.
    const states = Object.fromEntries(page.turns.map((t) => [t.id, t.status]));
    const [first, second] = [a, b].sort((x, y) => page.turns.find((t) => t.id === x.turnId)!.seq - page.turns.find((t) => t.id === y.turnId)!.seq);
    expect([states[first.turnId], states[second.turnId]]).toEqual(['running', 'queued']);

    await held.answer(first.turnId, 'Answer one.');
    await held.waitFor(2);
    await held.answer(second.turnId, 'Answer two.');
    const { settledTeamAi } = await import('./chat');
    await settledTeamAi();
    expect(held.overlapped()).toBe(false);
    expect(held.calls.map((c) => c.member).sort()).toEqual(['Maya', 'Trey']);

    page = await member.team.ai.events.query({ chatId: main.id });
    const messages = page.events.filter((e) => e.source === 'user').map((e) => [e.author?.name, e.content]);
    expect(messages).toEqual(expect.arrayContaining([['Maya', 'What did we decide about billing?'], ['Trey', 'And when do we release?']]));
    expect(page.turns.map((t) => t.status)).toEqual(['done', 'done']);
    // No provider record reaches a member's screen.
    expect(JSON.stringify(page)).not.toContain('"raw"');
  });

  it('makes one turn of a retried send, and refuses the same send id for another message', async () => {
    await turnOn();
    const member = await teamTrpc(maya.token);
    const [main] = await member.team.ai.chats.list.query();
    const id = sendId();
    const first = await member.team.ai.send.mutate({ chatId: main.id, clientSendId: id, text: 'Once' });
    const again = await member.team.ai.send.mutate({ chatId: main.id, clientSendId: id, text: 'Once' });
    expect(again).toMatchObject({ turnId: first.turnId, messageId: first.messageId, created: false });
    expect(await status(member.team.ai.send.mutate({ chatId: main.id, clientSendId: id, text: 'Twice' }))).toBe(409);
    const page = await member.team.ai.events.query({ chatId: main.id });
    expect(page.turns).toHaveLength(1);
    expect(page.events.filter((e) => e.source === 'user')).toHaveLength(1);
  });

  it('pages back through shared history without exposing runtime rows or losing the live cursor', async () => {
    await turnOn();
    const owner = await teamTrpc(team.owner.token);
    const q = await import('@/lib/db/queries');
    const [chat] = await owner.team.ai.chats.list.query();
    for (let i = 0; i < 205; i++) q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: `Message ${i}` });
    q.insertChatEvent({ sessionId: chat.id, role: 'system', source: 'system', content: 'Runtime only' });
    const latest = await owner.team.ai.events.query({ chatId: chat.id });
    expect(latest.events[0].content).toBe('Message 6');
    expect(latest).toMatchObject({ hasOlder: true, oldestCursor: expect.any(Number) });
    const older = await owner.team.ai.events.query({ chatId: chat.id, before: latest.oldestCursor! });
    expect(older.events.map(event => event.content)).toEqual(Array.from({ length: 6 }, (_, i) => `Message ${i}`));
    expect(older.hasOlder).toBe(false);
    expect((await owner.team.ai.events.query({ chatId: chat.id, after: latest.cursor })).events).toEqual([]);
  });

  it('picks up after a cursor with exactly what was missed', async () => {
    await turnOn();
    const member = await teamTrpc(maya.token);
    const [main] = await member.team.ai.chats.list.query();
    const sent = await member.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'First' });
    const opened = await member.team.ai.events.query({ chatId: main.id });
    await held.waitFor(1);
    await held.answer(sent.turnId, 'Reply');
    const later = await member.team.ai.events.query({ chatId: main.id, after: opened.cursor });
    expect(later.events.map((e) => e.content)).toEqual(['Reply']);
    expect((await member.team.ai.events.query({ chatId: main.id, after: later.cursor })).events).toEqual([]);
  });

  it('stops running and queued work when the owner removes the provider key', async () => {
    await turnOn();
    const owner = await teamTrpc(team.owner.token);
    const [chat] = await owner.team.ai.chats.list.query();
    const first = await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: sendId(), text: 'Running' });
    await held.waitFor(1);
    const waiting = await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: sendId(), text: 'Waiting' });
    await owner.team.ai.forgetKey.mutate();
    const q = await import('@/lib/db/queries');
    expect(q.getTeamChatTurn(first.turnId)).toMatchObject({ status: 'cancelled', error: expect.stringMatching(/key was removed/) });
    expect(q.getTeamChatTurn(waiting.turnId)).toMatchObject({ status: 'cancelled', error: expect.stringMatching(/key was removed/) });
    expect(held.calls).toHaveLength(1);
  });

  it('stops everything when turned off, and keeps records and members\' AI clients working', async () => {
    await turnOn();
    const owner = await teamTrpc(team.owner.token);
    const member = await teamTrpc(maya.token);
    const [main] = await member.team.ai.chats.list.query();
    const running = await member.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'Long question' });
    const waiting = await owner.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'Next question' });
    await held.waitFor(1);
    await owner.team.ai.setEnabled.mutate({ enabled: false });
    const page = await member.team.ai.events.query({ chatId: main.id });
    expect(page.turns.find((t) => t.id === running.turnId)).toMatchObject({ status: 'cancelled', error: 'Team AI was turned off.' });
    expect(page.turns.find((t) => t.id === waiting.turnId)).toMatchObject({ status: 'cancelled' });
    // Shared work and a member's own assistant are untouched.
    const { client, token } = await member.team.aiClients.create.mutate({ name: 'Codex' });
    expect(client.name).toBe('Codex');
    const listed = await serveTeam('http://team.test/api/team/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(listed.status).toBe(200);
    expect((await member.notes.create.mutate({ body: 'Still works' })).body).toBe('Still works');
  });

  it('stops a removed member\'s work and lets everyone else\'s go on', async () => {
    await turnOn();
    const owner = await teamTrpc(team.owner.token);
    const member = await teamTrpc(maya.token);
    const [main] = await member.team.ai.chats.list.query();
    const mayas = await member.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'Mine' });
    const treys = await owner.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'Owner question' });
    await held.waitFor(1);
    await owner.team.removeMember.mutate({ id: maya.id });
    await held.waitFor(2);
    expect(held.calls[1]).toMatchObject({ turnId: treys.turnId, member: 'Trey' });
    await held.answer(treys.turnId, 'Owner answer');
    const { settledTeamAi } = await import('./chat');
    await settledTeamAi();
    const page = await owner.team.ai.events.query({ chatId: main.id });
    expect(page.turns.find((t) => t.id === mayas.turnId)).toMatchObject({ status: 'cancelled' });
    expect(page.turns.find((t) => t.id === treys.turnId)).toMatchObject({ status: 'done' });
    // Her messages keep her name.
    expect(page.events.find((e) => e.content === 'Mine')?.author).toEqual({ id: maya.id, name: 'Maya' });
    expect(await status(member.team.ai.events.query({ chatId: main.id }))).toBe(401);
  });

  it('marks a turn the restart cut off as interrupted, never running it again, and goes on with waiting ones', async () => {
    await turnOn();
    const member = await teamTrpc(maya.token);
    const [main] = await member.team.ai.chats.list.query();
    const q = await import('@/lib/db/queries');
    // As the database stood when the team stopped: one running, one waiting.
    const cut = q.acceptTeamChatSend({ chatId: main.id, memberId: maya.id, clientSendId: sendId(), text: 'Cut off' });
    q.claimNextTeamChatTurn(main.id);
    const waiting = q.acceptTeamChatSend({ chatId: main.id, memberId: maya.id, clientSendId: sendId(), text: 'Waiting' });
    const { resumeTeamAiAfterStart } = await import('./chat');
    resumeTeamAiAfterStart();
    await held.waitFor(1);
    expect(held.calls.map((c) => c.text)).toEqual(['Waiting']);
    await held.answer(waiting.turn.id, 'Done');
    const { settledTeamAi } = await import('./chat');
    await settledTeamAi();
    const page = await member.team.ai.events.query({ chatId: main.id });
    expect(page.turns.find((t) => t.id === cut.turn.id)).toMatchObject({ status: 'interrupted' });
    expect(page.turns.find((t) => t.id === waiting.turn.id)).toMatchObject({ status: 'done' });
  });

  it('becomes unavailable when the team\'s key is refused, until the owner saves another', async () => {
    await turnOn();
    const owner = await teamTrpc(team.owner.token);
    const member = await teamTrpc(maya.token);
    const [main] = await member.team.ai.chats.list.query();
    const sent = await member.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'Hello' });
    await held.waitFor(1);
    await held.answer(sent.turnId, '', { status: 'failed', code: 'credential_rejected', error: "The team's provider key was refused." });
    const { settledTeamAi } = await import('./chat');
    await settledTeamAi();
    expect(await member.team.ai.status.query()).toMatchObject({ state: 'unavailable', reason: expect.stringMatching(/refused/) });
    expect(await status(member.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'Again' }))).toBe(412);
    expect(await owner.team.ai.configure.mutate({ apiKey: 'sk-ant-new', credentialLabel: "Acme's Anthropic account" })).toMatchObject({ state: 'ready' });
  });

  it('gives a running turn the team\'s tools and nothing else, for as long as it runs', async () => {
    await turnOn();
    const member = await teamTrpc(maya.token);
    const [main] = await member.team.ai.chats.list.query();
    const sent = await member.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'Hello' });
    await held.waitFor(1);
    const { mintTurnToken } = await import('./turn-credential');
    const token = mintTurnToken({ turnId: sent.turnId, chatId: main.id, memberId: maya.id });
    const mcp = (bearer: string) => serveTeam('http://team.test/api/team/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect((await mcp(token)).status).toBe(200);
    // Not the app's API, its files, its admission or the host's routes.
    for (const [path, method] of [['/api/trpc/tasks.list', 'GET'], ['/api/trpc/team.invitations.create', 'POST'], ['/api/attachments/x.png', 'GET'], ['/api/team/host/status', 'GET']] as const) {
      const res = await serveTeam(`http://team.test${path}`, { method, headers: { authorization: `Bearer ${token}` } });
      expect(res.status, path).toBe(403);
    }
    // Someone else's turn, or a forged one, gets nothing.
    expect((await mcp(mintTurnToken({ turnId: sent.turnId, chatId: main.id, memberId: team.owner.id }))).status).toBe(401);
    expect((await mcp(`${token}x`)).status).toBe(401);
    await held.answer(sent.turnId, 'Hi');
    const { settledTeamAi } = await import('./chat');
    await settledTeamAi();
    // Over with its turn.
    expect((await mcp(token)).status).toBe(401);
  });

  it('records nothing for a send it refuses, so the same send works once Team AI can answer', async () => {
    await turnOn();
    const owner = await teamTrpc(team.owner.token);
    const member = await teamTrpc(maya.token);
    const [main] = await member.team.ai.chats.list.query();
    await owner.team.ai.setEnabled.mutate({ enabled: false });
    const id = sendId();
    expect(await status(member.team.ai.send.mutate({ chatId: main.id, clientSendId: id, text: 'Hello later' }))).toBe(412);
    let page = await member.team.ai.events.query({ chatId: main.id });
    expect(page.events.some((e) => e.content === 'Hello later')).toBe(false);
    expect(page.turns).toEqual([]);

    await owner.team.ai.setEnabled.mutate({ enabled: true });
    const sent = await member.team.ai.send.mutate({ chatId: main.id, clientSendId: id, text: 'Hello later' });
    expect(sent.created).toBe(true);
    await held.waitFor(1);
    await held.answer(sent.turnId, 'Hello now');
    const { settledTeamAi } = await import('./chat');
    await settledTeamAi();
    page = await member.team.ai.events.query({ chatId: main.id });
    expect(page.turns).toEqual([expect.objectContaining({ id: sent.turnId, status: 'done' })]);
  });

  it('runs one loop per chat however often it\'s kicked, so every running turn stays stoppable', async () => {
    await turnOn();
    const member = await teamTrpc(maya.token);
    const [main] = await member.team.ai.chats.list.query();
    const q = await import('@/lib/db/queries');
    const { probeTeamAiRuntime } = await import('./probe');
    const probe = vi.mocked(probeTeamAiRuntime);
    // Hold the readiness check, so every kick lands while the first is still deciding.
    let release!: () => void;
    probe.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ ok: true, version: '2.1.295 (Claude Code)', missing: [], error: null }); }));
    const before = probe.mock.calls.length;
    const accepted = q.acceptTeamChatSend({ chatId: main.id, memberId: maya.id, clientSendId: sendId(), text: 'Kicked often' });
    const { kickTeamChat, settledTeamAi } = await import('./chat');
    for (let i = 0; i < 5; i++) kickTeamChat(main.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(probe.mock.calls.length - before).toBe(1);
    release();
    await held.waitFor(1);
    await member.team.ai.stop.mutate({ turnId: accepted.turn.id });
    await settledTeamAi();
    expect(q.getTeamChatTurn(accepted.turn.id)).toMatchObject({ status: 'cancelled', error: 'Stopped by Maya.' });
  });

  it('picks up a send that arrives as the turn before it ends, and can still stop it', async () => {
    await turnOn();
    const member = await teamTrpc(maya.token);
    const [main] = await member.team.ai.chats.list.query();
    const first = await member.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'First' });
    await held.waitFor(1);
    // The first turn ends while the second send is on its way.
    const ending = held.answer(first.turnId, 'One');
    const second = await member.team.ai.send.mutate({ chatId: main.id, clientSendId: sendId(), text: 'Second' });
    await ending;
    await held.waitFor(2);
    expect(held.calls[1]).toMatchObject({ turnId: second.turnId });
    // The running second turn is still tracked, so Stop reaches it.
    await member.team.ai.stop.mutate({ turnId: second.turnId });
    const { settledTeamAi } = await import('./chat');
    await settledTeamAi();
    const page = await member.team.ai.events.query({ chatId: main.id });
    expect(page.turns.map((t) => [t.id, t.status, t.error])).toEqual([
      [first.turnId, 'done', null],
      [second.turnId, 'cancelled', 'Stopped by Maya.'],
    ]);
    expect(held.overlapped()).toBe(false);
  });

  it('shows members what was said and done, never the runtime\'s own records, and moves past those too', async () => {
    await turnOn();
    const member = await teamTrpc(maya.token);
    const [main] = await member.team.ai.chats.list.query();
    const opened = await member.team.ai.events.query({ chatId: main.id });
    const q = await import('@/lib/db/queries');
    const now = new Date().toISOString();
    q.insertChatEvent({ sessionId: main.id, role: 'system', source: 'system', content: 'init /srv/team/.work/team-ai/runtime', createdAt: now });
    q.insertChatEvent({ sessionId: main.id, role: 'assistant', source: 'agent', content: 'Visible', createdAt: now });
    const page = await member.team.ai.events.query({ chatId: main.id, after: opened.cursor });
    expect(page.events.map((e) => e.content)).toEqual(['Visible']);
    expect(JSON.stringify(page)).not.toContain('/srv/team');
    expect((await member.team.ai.events.query({ chatId: main.id, after: page.cursor })).events).toEqual([]);
  });

  it('lets a member make more chats and stop their own turn', async () => {
    await turnOn();
    const member = await teamTrpc(maya.token);
    const chat = await member.team.ai.chats.create.mutate({ label: 'Release planning' });
    const sent = await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: sendId(), text: 'Plan it' });
    await held.waitFor(1);
    await member.team.ai.stop.mutate({ turnId: sent.turnId });
    const { settledTeamAi } = await import('./chat');
    await settledTeamAi();
    const page = await member.team.ai.events.query({ chatId: chat.id });
    expect(page.turns[0]).toMatchObject({ status: 'cancelled', error: 'Stopped by Maya.' });
    expect((await member.team.ai.chats.list.query()).map((c) => c.label).sort()).toEqual(['Acme', 'Release planning']);
  });
});
