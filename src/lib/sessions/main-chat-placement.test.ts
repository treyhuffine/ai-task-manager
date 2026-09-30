/**
 * An agent's main chat runs where the agent lives (spec §7, P3.4): the home
 * when the agent is set up there, otherwise its saved default. Once it has
 * run it keeps that device, and a message waits for it while it's away
 * rather than running at home. Until then it follows the agent
 * (docs/homes-build.md, "Main chats follow their agent until they run"). A
 * new chat applies the rule again. The app's own main chat is the home's.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { setUpAgentOn } from '@/test/fixtures/setups';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';
import type { WorkerHarnessReport } from '@/db/types';

const HARNESSES: WorkerHarnessReport[] = [
  { harness: 'claude', binary: { status: 'supported', version: '9.9.9' }, capabilities: { sessions: { supported: true } } } as WorkerHarnessReport,
];

let home: TestHome;
let fake: FakeHarness;
let hostId: string;
let laptopId: string;
let desktopId: string;
let agentId: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-main-chat-placement-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  hostId = identity.ensureHomeIdentity().home.hostDeviceId!;
  const q = await import('@/lib/db/queries');
  const enroll = (name: string) => {
    const grant = q.createDeviceGrant({ kind: 'enroll', deviceId: null, deviceName: name, createdByApiKeyId: null });
    const id = q.redeemEnrollGrant({ secret: grant.secret, name }).device.id;
    q.recordWorkerHeartbeat(id, { protocol: WORKER_PROTOCOL, version: 'test', harnesses: HARNESSES, state: 'awake' });
    return id;
  };
  laptopId = enroll('MacBook');
  desktopId = enroll('Studio');
  agentId = q.createWorkspace({ name: 'Ri', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  fake = installFakeHarness('claude');
});

afterEach(async () => {
  fake.restore();
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

async function setUpOn(deviceId: string) {
  await setUpAgentOn(agentId, deviceId, deviceId === hostId ? home.root : '/Users/trey/code/ri');
}

async function placementOfMainChat(scope: string | null) {
  const { ensureMainChat } = await import('./main-chat');
  const q = await import('@/lib/db/queries');
  const chat = await ensureMainChat(scope);
  return { chat, placement: q.chatPlacement(chat.id)! };
}

describe("an agent's main chat", () => {
  it('runs on the home when the agent is set up there, even with another device saved as its default', async () => {
    await setUpOn(hostId);
    await setUpOn(laptopId);
    (await import('@/lib/setups/run-on')).setDefaultDevice(agentId, laptopId);
    const { chat, placement } = await placementOfMainChat(agentId);
    expect(chat.deviceId).toBeNull();
    expect(placement).toMatchObject({ deviceId: hostId, isHome: true });
  });

  it('runs on the home for an agent from before setups, and the app main chat always does', async () => {
    expect((await placementOfMainChat(agentId)).placement).toMatchObject({ isHome: true });
    await setUpOn(laptopId);
    expect((await placementOfMainChat(null)).placement).toMatchObject({ deviceId: hostId, isHome: true });
  });

  it("is pinned to the agent's saved default when the agent isn't set up on the home", async () => {
    await setUpOn(laptopId);
    await setUpOn(desktopId);
    (await import('@/lib/setups/run-on')).setDefaultDevice(agentId, desktopId);
    const { chat, placement } = await placementOfMainChat(agentId);
    expect(chat.deviceId).toBe(desktopId);
    expect(placement).toMatchObject({ deviceId: desktopId, isHome: false, executionId: null });
  });

  it('is pinned to the first device set up for it when nothing is saved', async () => {
    await setUpOn(laptopId);
    await setUpOn(desktopId);
    expect((await placementOfMainChat(agentId)).chat.deviceId).toBe(laptopId);
  });

  it('keeps its device once it has run there, and a new chat applies the rule again', async () => {
    await setUpOn(laptopId);
    await setUpOn(desktopId);
    const q = await import('@/lib/db/queries');
    const runOn = await import('@/lib/setups/run-on');
    const { ensureMainChat, startNewMainChat } = await import('./main-chat');
    const { followAgentUntilRun } = await import('./main-chat-device');
    const first = await ensureMainChat(agentId);
    expect(first.deviceId).toBe(laptopId);
    q.insertChatEvent({ sessionId: first.id, role: 'assistant', source: 'agent', content: 'Looked at it on the MacBook.' });
    runOn.setDefaultDevice(agentId, desktopId);
    expect(followAgentUntilRun(first.id)).toEqual({ moved: false, withdrawn: 0 });
    expect((await ensureMainChat(agentId)).id).toBe(first.id);
    expect((await ensureMainChat(agentId)).deviceId).toBe(laptopId);
    const second = await startNewMainChat(agentId);
    expect(second.deviceId).toBe(desktopId);
  });

  it("follows its agent until it has run: one that hasn't run goes where the agent's default is now", async () => {
    await setUpOn(laptopId);
    await setUpOn(desktopId);
    const { ensureMainChat } = await import('./main-chat');
    const { followAgentUntilRun } = await import('./main-chat-device');
    const chat = await ensureMainChat(agentId);
    expect(chat.deviceId).toBe(laptopId);
    (await import('@/lib/setups/run-on')).setDefaultDevice(agentId, desktopId);
    expect(followAgentUntilRun(chat.id)).toEqual({ moved: true, withdrawn: 0 });
    expect((await import('@/lib/db/queries')).chatPlacement(chat.id)).toMatchObject({ deviceId: desktopId });
  });

  it("waits for its device while it's away, instead of running at home", async () => {
    await setUpOn(laptopId);
    const q = await import('@/lib/db/queries');
    const executor = await import('@/lib/executor/adapter');
    const { deliveriesForChat } = await import('@/lib/workers/delivery');
    const { chat } = await placementOfMainChat(agentId);
    const message = q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'What changed today?', createdAt: new Date().toISOString() })!;
    let queued!: () => void;
    const onQueue = new Promise<void>((r) => { queued = r; });
    void executor.dispatch(chat.id, 'What changed today?', { sourceEventId: message.id, onQueued: () => queued() }).catch(() => {});
    await onQueue;
    expect(q.listWorkerCommands(laptopId).map((c) => [c.kind, c.state])).toContainEqual(['send', 'queued']);
    expect(deliveriesForChat(chat.id)[message.id]).toMatchObject({ state: 'waiting', deviceName: 'MacBook' });
    expect(fake.sessions).toEqual([]);
  });
});

describe("a main chat opened before its agent was set up where it lives now (Bounce, 2026-09-30)", () => {
  // Opened while the agent's only folder was on a device that doesn't run
  // agents yet (imported from its old home), then set up on the home.
  async function openedOnAnUnenrolledDevice() {
    const q = await import('@/lib/db/queries');
    const macbook = q.createDevice({ name: 'MacBook Air', kind: 'computer' }).id;
    await setUpOn(macbook);
    const { ensureMainChat } = await import('./main-chat');
    const chat = await ensureMainChat(agentId);
    expect(chat.deviceId).toBe(macbook);
    return { chat, macbook };
  }

  it("says its device doesn't run agents yet, how to turn it on, and that the home can run it once set up there", async () => {
    const { chat } = await openedOnAnUnenrolledDevice();
    const q = await import('@/lib/db/queries');
    const message = q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'Review this doc' })!;
    const executor = await import('@/lib/executor/adapter');
    const home = q.getDevice(hostId)!.name;
    let taken = false;
    await expect(
      executor.dispatch(chat.id, 'Review this doc', { sourceEventId: message.id, onTaken: () => { taken = true; } }),
    ).rejects.toThrow(`MacBook Air doesn't run agents yet. To turn it on, run \`ri worker enroll\` on it. Or set Ri up on ${home} in its Setup tab.`);
    // Nothing took it, so the chat is the one to say why.
    expect(taken).toBe(false);
  });

  it('runs on the home once the agent is set up there, the next time a message is sent', async () => {
    const { chat, macbook } = await openedOnAnUnenrolledDevice();
    await setUpOn(hostId);
    const q = await import('@/lib/db/queries');
    const message = q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'Review this doc' })!;
    await (await import('@/lib/executor/adapter')).dispatch(chat.id, 'Review this doc', { sourceEventId: message.id });
    expect(q.chatPlacement(chat.id)).toMatchObject({ deviceId: hostId, isHome: true });
    expect(q.listWorkerCommands(macbook)).toEqual([]);
    expect(fake.sessions.length).toBe(1);
  });

  it('after New and going back to it, moves to the home on open and drops the stop it left for a device it never ran on', async () => {
    const { chat, macbook } = await openedOnAnUnenrolledDevice();
    await setUpOn(hostId);
    const q = await import('@/lib/db/queries');
    // What New queued as it closed the chat, before the person went back to it.
    q.queueWorkerCommand({ deviceId: macbook, kind: 'stop', payload: {}, actor: { source: 'human' }, chatSessionId: chat.id });
    const { followAgentUntilRun } = await import('./main-chat-device');
    expect(followAgentUntilRun(chat.id)).toEqual({ moved: true, withdrawn: 0 });
    expect(q.chatPlacement(chat.id)).toMatchObject({ isHome: true });
    expect(q.listWorkerCommands(macbook).map((c) => [c.kind, c.state])).toEqual([['stop', 'cancelled']]);
  });

  it("withdraws a waiting message for a device that doesn't run agents, saying to send it again", async () => {
    const { chat, macbook } = await openedOnAnUnenrolledDevice();
    await setUpOn(hostId);
    const q = await import('@/lib/db/queries');
    const message = q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'Waiting' })!;
    q.queueWorkerCommand({ deviceId: macbook, kind: 'send', payload: { runId: null }, actor: { source: 'human' }, chatSessionId: chat.id, sourceEventId: message.id });
    const { followAgentUntilRun } = await import('./main-chat-device');
    expect(followAgentUntilRun(chat.id)).toEqual({ moved: true, withdrawn: 1 });
    const { deliveriesForChat } = await import('@/lib/workers/delivery');
    expect(deliveriesForChat(chat.id)[message.id]).toMatchObject({
      state: 'not_delivered',
      reason: expect.stringMatching(/Ri runs on .+ now, and this was still waiting for MacBook Air\. Send it again\./),
    });
  });

  it('keeps a message waiting for a device that runs agents: it goes there when that device connects', async () => {
    await setUpOn(laptopId);
    const q = await import('@/lib/db/queries');
    const { ensureMainChat } = await import('./main-chat');
    const chat = await ensureMainChat(agentId);
    const message = q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'Later', createdAt: new Date().toISOString() })!;
    let queued!: () => void;
    const onQueue = new Promise<void>((r) => { queued = r; });
    void (await import('@/lib/executor/adapter')).dispatch(chat.id, 'Later', { sourceEventId: message.id, onQueued: () => queued() }).catch(() => {});
    await onQueue;
    const { deliveriesForChat } = await import('@/lib/workers/delivery');
    expect(deliveriesForChat(chat.id)[message.id]).toMatchObject({ state: 'waiting', runsAgents: true });
    await setUpOn(hostId);
    const { followAgentUntilRun } = await import('./main-chat-device');
    expect(followAgentUntilRun(chat.id)).toEqual({ moved: false, withdrawn: 0 });
    expect(q.listWorkerCommands(laptopId).map((c) => c.state)).toContain('queued');
  });

  it('withdraws what a closed chat still had waiting, so it never runs later', async () => {
    await setUpOn(laptopId);
    const q = await import('@/lib/db/queries');
    const { ensureMainChat, startNewMainChat } = await import('./main-chat');
    const chat = await ensureMainChat(agentId);
    const message = q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'Later', createdAt: new Date().toISOString() })!;
    let queued!: () => void;
    const onQueue = new Promise<void>((r) => { queued = r; });
    void (await import('@/lib/executor/adapter')).dispatch(chat.id, 'Later', { sourceEventId: message.id, onQueued: () => queued() }).catch(() => {});
    await onQueue;
    await startNewMainChat(agentId);
    const sends = q.listWorkerCommands(laptopId).filter((c) => c.kind === 'send');
    expect(sends.map((c) => [c.state, c.error])).toEqual([['cancelled', 'This chat was closed before it was delivered.']]);
    expect(q.getChatSession(chat.id)?.status).toBe('archived');
  });
});

describe('where scheduled work for an agent can start', () => {
  it('is the home, unless the agent is set up only elsewhere', async () => {
    const { homeCantRun } = await import('@/lib/setups/run-on');
    expect(homeCantRun(agentId)).toBeNull();
    await setUpOn(laptopId);
    expect(homeCantRun(agentId)).toMatch(/^Ri isn't set up on .+, where scheduled work runs\./);
    await setUpOn(hostId);
    expect(homeCantRun(agentId)).toBeNull();
  });
});
