/**
 * A message waiting for a device that's away can wait for days, and a restart
 * doesn't touch it, because its queue is durable. So it mustn't hold the lease
 * an update or restart waits for.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkerHarnessReport } from '@/db/types';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';

const HARNESSES: WorkerHarnessReport[] = [
  { harness: 'claude', binary: { status: 'supported', version: '9.9.9' }, capabilities: { sessions: { supported: true } } } as WorkerHarnessReport,
];
let home: TestHome;
let chatId: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-away-lease-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  const grant = q.createDeviceGrant({ kind: 'enroll', deviceId: null, deviceName: 'MacBook', createdByApiKeyId: null });
  const laptopId = q.redeemEnrollGrant({ secret: grant.secret, name: 'MacBook' }).device.id;
  q.recordWorkerHeartbeat(laptopId, { protocol: WORKER_PROTOCOL, version: 'test', harnesses: HARNESSES, state: 'awake' });
  const workspace = q.createWorkspace({ name: 'Ri', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const created = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', label: 'On the laptop' });
  chatId = created.session.id;
  q.createPlacement({ executionId: created.execution.id, deviceId: laptopId, startReason: 'created', worktreePath: '/Users/owner/code/ri' });
});
afterEach(async () => {
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

it('lets go of the lease while a message waits for a device that is away', async () => {
  const q = await import('@/lib/db/queries');
  const executor = await import('@/lib/executor/adapter');
  const { exclusiveActivity } = await import('@/lib/service/maintenance');
  const message = q.insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content: 'Hello', createdAt: new Date().toISOString() })!;
  const preparation = executor.beginDispatchPreparation(chatId);
  let queued = false;
  void executor.dispatch(chatId, 'Hello', { sourceEventId: message.id, onQueued: () => { executor.endDispatchPreparation(chatId, preparation); queued = true; } }).catch(() => {});
  await vi.waitFor(() => expect(queued).toBe(true));
  await vi.waitFor(() => { exclusiveActivity()(); });
});
