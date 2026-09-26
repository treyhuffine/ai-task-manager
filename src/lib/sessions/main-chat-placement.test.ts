/**
 * An agent's main chat has a fixed computer (spec §7, P3.4): the home when
 * the agent is set up there, otherwise its saved default. The chat keeps it,
 * and a message waits for it while it's away rather than running at home. A
 * new chat applies the rule again. The app's own main chat is the home's.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
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
  hostId = identity.ensureHomeIdentity().home.hostComputerId!;
  const q = await import('@/lib/db/queries');
  const enroll = (name: string) => {
    const grant = q.createComputerGrant({ kind: 'enroll', computerId: null, computerName: name, createdByApiKeyId: null });
    const id = q.redeemEnrollGrant({ secret: grant.secret, name }).computer.id;
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

async function setUpOn(computerId: string) {
  const q = await import('@/lib/db/queries');
  q.recordAgentSetupReports(computerId, [{
    agentId, sourcePath: computerId === hostId ? home.root : '/Users/trey/code/ri', configRevision: null,
    status: 'ready', problem: null, references: [],
  }], { complete: true });
}

async function placementOfMainChat(scope: string | null) {
  const { ensureMainChat } = await import('./main-chat');
  const q = await import('@/lib/db/queries');
  const chat = await ensureMainChat(scope);
  return { chat, placement: q.chatPlacement(chat.id)! };
}

describe("an agent's main chat", () => {
  it('runs on the home when the agent is set up there, even with another computer saved as its default', async () => {
    await setUpOn(hostId);
    await setUpOn(laptopId);
    (await import('@/lib/setups/run-on')).setDefaultComputer(agentId, laptopId);
    const { chat, placement } = await placementOfMainChat(agentId);
    expect(chat.computerId).toBeNull();
    expect(placement).toMatchObject({ computerId: hostId, isHome: true });
  });

  it('runs on the home for an agent from before setups, and the app main chat always does', async () => {
    expect((await placementOfMainChat(agentId)).placement).toMatchObject({ isHome: true });
    await setUpOn(laptopId);
    expect((await placementOfMainChat(null)).placement).toMatchObject({ computerId: hostId, isHome: true });
  });

  it("is pinned to the agent's saved default when the agent isn't set up on the home", async () => {
    await setUpOn(laptopId);
    await setUpOn(desktopId);
    (await import('@/lib/setups/run-on')).setDefaultComputer(agentId, desktopId);
    const { chat, placement } = await placementOfMainChat(agentId);
    expect(chat.computerId).toBe(desktopId);
    expect(placement).toMatchObject({ computerId: desktopId, isHome: false, executionId: null });
  });

  it('is pinned to the first computer set up for it when nothing is saved', async () => {
    await setUpOn(laptopId);
    await setUpOn(desktopId);
    expect((await placementOfMainChat(agentId)).chat.computerId).toBe(laptopId);
  });

  it('keeps its computer when the default changes, and a new chat applies the rule again', async () => {
    await setUpOn(laptopId);
    await setUpOn(desktopId);
    const runOn = await import('@/lib/setups/run-on');
    const { ensureMainChat, startNewMainChat } = await import('./main-chat');
    const first = await ensureMainChat(agentId);
    expect(first.computerId).toBe(laptopId);
    runOn.setDefaultComputer(agentId, desktopId);
    expect((await ensureMainChat(agentId)).id).toBe(first.id);
    expect((await ensureMainChat(agentId)).computerId).toBe(laptopId);
    const second = await startNewMainChat(agentId);
    expect(second.computerId).toBe(desktopId);
  });

  it("waits for its computer while it's away, instead of running at home", async () => {
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
    expect(deliveriesForChat(chat.id)[message.id]).toMatchObject({ state: 'waiting', computerName: 'MacBook' });
    expect(fake.sessions).toEqual([]);
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
