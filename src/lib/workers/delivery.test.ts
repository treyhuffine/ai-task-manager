/**
 * Where a message sent to a computer elsewhere stands (P3.2): waiting while
 * its computer is away, on its way, delivered, withdrawn, and never "working"
 * while it only waits in the queue.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkerHarnessReport } from '@/db/types';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';

const HARNESSES: WorkerHarnessReport[] = [
  { harness: 'claude', binary: { status: 'supported', version: '9.9.9' }, capabilities: { sessions: { supported: true } } } as WorkerHarnessReport,
];

let home: TestHome;
let laptopId: string;
let chatId: string;
let heard: Array<{ eventId: string; delivery: { state: string } }>;
let unsubscribe: () => void;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-delivery-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  const grant = q.createComputerGrant({ kind: 'enroll', computerId: null, computerName: 'MacBook', createdByApiKeyId: null });
  laptopId = q.redeemEnrollGrant({ secret: grant.secret, name: 'MacBook' }).computer.id;
  q.recordWorkerHeartbeat(laptopId, { protocol: WORKER_PROTOCOL, version: 'test', harnesses: HARNESSES, state: 'awake' });
  const ws = q.createWorkspace({ name: 'Ri', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const created = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'On the laptop' });
  chatId = created.session.id;
  q.createPlacement({ executionId: created.execution.id, computerId: laptopId, startReason: 'created', worktreePath: '/Users/trey/code/ri' });
  heard = [];
  const bus = await import('@/lib/realtime/bus');
  unsubscribe = bus.subscribe(bus.sessionChannel(chatId), (m) => {
    if (m.kind === 'delivery') heard.push({ eventId: m.eventId, delivery: m.delivery as { state: string } });
  });
});

afterEach(async () => {
  unsubscribe();
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

/** Send as the messages route does: hold the chat while dispatching, let go once queued. */
async function sendMessage(content: string) {
  const q = await import('@/lib/db/queries');
  const executor = await import('@/lib/executor/adapter');
  const message = q.insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content, createdAt: new Date().toISOString() })!;
  const ref = executor.beginDispatchPreparation(chatId);
  let held = true;
  const release = () => { if (held) { held = false; executor.endDispatchPreparation(chatId, ref); } };
  let queued!: () => void;
  const onQueue = new Promise<void>((r) => { queued = r; });
  const outcome = executor
    .dispatch(chatId, content, { sourceEventId: message.id, onQueued: () => { release(); queued(); } })
    .then(() => null, (err: Error) => err.message)
    .finally(release);
  await onQueue;
  return { eventId: message.id, outcome };
}

describe('a message to a computer elsewhere', () => {
  it('waits while its computer is away, and the chat is not working while it waits', async () => {
    const executor = await import('@/lib/executor/adapter');
    const { deliveriesForChat } = await import('./delivery');
    const { eventId } = await sendMessage('Hello from the phone');
    expect(deliveriesForChat(chatId)[eventId]).toMatchObject({ state: 'waiting', computerName: 'MacBook', connected: false, cancellable: true });
    expect(heard.at(-1)).toMatchObject({ eventId, delivery: { state: 'waiting' } });
    expect(executor.isRunning(chatId)).toBe(false);
  });

  it('can be withdrawn while it waits: not delivered, its run failed, its turn settled', async () => {
    const q = await import('@/lib/db/queries');
    const { POST } = await import('@/app/api/sessions/[id]/deliveries/[eventId]/cancel/route');
    const { eventId, outcome } = await sendMessage('Never mind');
    const res = await POST(new Request('http://x', { method: 'POST' }) as never, { params: Promise.resolve({ id: chatId, eventId }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'not_delivered', cancellable: false });
    expect(await outcome).toBe('The message was withdrawn before it was delivered.');
    expect(q.listRuns({}).find((r) => r.chatSessionId === chatId)).toMatchObject({ status: 'failed', errorCode: 'delivery_cancelled' });
    expect(heard.at(-1)).toMatchObject({ eventId, delivery: { state: 'not_delivered' } });
  });

  it("can't be withdrawn once it's on its way, only the execution stopped", async () => {
    const q = await import('@/lib/db/queries');
    const { POST } = await import('@/app/api/sessions/[id]/deliveries/[eventId]/cancel/route');
    const { deliveriesForChat } = await import('./delivery');
    const { eventId } = await sendMessage('Already going');
    q.takeCommandsForStream(laptopId, 0);
    expect(deliveriesForChat(chatId)[eventId]).toMatchObject({ state: 'sending', cancellable: false });
    const res = await POST(new Request('http://x', { method: 'POST' }) as never, { params: Promise.resolve({ id: chatId, eventId }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'on_its_way', message: "It's already on its way to MacBook. Stop the execution to keep it from running." });
  });

  it('shows as delivered once the worker acknowledges it, and uncertain when it can not tell', async () => {
    const q = await import('@/lib/db/queries');
    const { deliveriesForChat } = await import('./delivery');
    const first = await sendMessage('One');
    const second = await sendMessage('Two');
    q.takeCommandsForStream(laptopId, 0);
    q.ackWorkerCommand(laptopId, q.getSendForEvent(first.eventId)!.id, { state: 'delivered' });
    q.ackWorkerCommand(laptopId, q.getSendForEvent(second.eventId)!.id, { state: 'uncertain', error: "The message isn't in the session's history after a restart." });
    const deliveries = deliveriesForChat(chatId);
    expect(deliveries[first.eventId]).toMatchObject({ state: 'delivered' });
    expect(deliveries[second.eventId]).toMatchObject({ state: 'uncertain', reason: "The message isn't in the session's history after a restart." });
  });
});
