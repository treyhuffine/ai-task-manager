import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProvider } from '@agentex/agent';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import type { TriggerRecord } from '@/db/types';

let home: TestHome;
let fake: FakeHarness;
// A provider-owned ID outside the bundled naming convention must survive too.
const liveModel = 'account-live-ultrafast';
const bundledModel = 'gpt-6.1-sol';
const serviceTiers = [
  { id: 'default', name: 'Normal', availability: 'available' as const },
  { id: 'ultrafast', name: 'Ultrafast', availability: 'available' as const },
];

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-trigger-selection-' });
  fake = installFakeHarness('codex');
  getProvider('codex').listModels = async () => [
    { id: liveModel, name: 'Live model', serviceTiers, defaultServiceTier: 'ultrafast', supportedEfforts: ['low', 'high'], defaultEffort: 'high' },
    { id: bundledModel, name: 'Bundled model', serviceTiers: serviceTiers.slice(0, 1) },
  ];
});

afterEach(async () => {
  (await import('./adapter'))._resetExecutorState();
  fake?.restore();
  await home?.cleanup();
});

async function schedule(targetKind: TriggerRecord['targetKind'], kind: TriggerRecord['kind'], speed: string | null | undefined) {
  const q = await import('@/lib/db/queries');
  const workspace = targetKind === 'workspace' ? q.createWorkspace({ name: 'Scheduled agent', cwd: home.root, isGit: false }) : null;
  const input = { name: 'Scheduled selection', harness: 'codex' as const, targetKind, workspaceId: workspace?.id ?? null,
    kind, prompt: 'Check the selected model', concurrencyPolicy: 'skip_if_running' as const,
    ...(kind === 'every' ? { intervalSeconds: 3600 } : {}),
    ...(kind === 'cron' ? { cronExpression: '0 9 * * *' } : {}),
    ...(kind === 'at' ? { runAt: new Date(Date.now() + 60_000).toISOString() } : {}) };
  if (speed === null) return q.createTrigger({ ...input, serviceTier: null });
  const { actions } = await import('@/lib/orchestrator/registry');
  const created = await actions.find(action => action.name === 'create_trigger')!.handler({ remote: false }, {
    ...input, provider: 'codex', ...(speed === undefined ? {} : { serviceTier: speed }),
  } as never) as { trigger: { id: string } };
  return q.getTrigger(created.trigger.id)!;
}

async function finished(runId: string) {
  const q = await import('@/lib/db/queries');
  await vi.waitFor(() => expect(['completed', 'failed']).toContain(q.getRun(runId)?.status), { timeout: 15_000 });
  return q.getRun(runId)!;
}

describe.each([
  { targetKind: 'workspace', kind: 'manual', fires: 1 },
  { targetKind: 'workspace', kind: 'at', fires: 1 },
  { targetKind: 'workspace', kind: 'every', fires: 2 },
  { targetKind: 'workspace', kind: 'cron', fires: 2 },
  { targetKind: 'orchestrator', kind: 'manual', fires: 1 },
] as const)('$targetKind $kind selection', ({ targetKind, kind, fires }) => {
  it.each([
    { speed: 'ultrafast', expected: 'ultrafast' },
    { speed: undefined, expected: 'default' },
    { speed: null, expected: null },
  ])('runs every fire on its live model with speed $expected, preserving legacy NULL', async ({ speed, expected }) => {
    const q = await import('@/lib/db/queries');
    const { dispatchRun } = await import('@/lib/runs/dispatch');
    const trigger = await schedule(targetKind, kind, speed);
    expect(trigger).toMatchObject({ model: null, serviceTier: expected });
    let executionId: string | null = null;
    for (let i = 0; i < fires; i++) {
      const fire = await dispatchRun({ trigger: q.getTrigger(trigger.id)!, triggerKind: 'manual' });
      expect(fire.chatSession).toMatchObject({ model: liveModel, effort: 'high', serviceTier: expected });
      expect(await finished(fire.run.id)).toMatchObject({ status: 'completed' });
      expect(fake.latest().ctx.config).toMatchObject({ model: liveModel, effort: 'high' });
      expect(fake.latest().ctx.config?.serviceTier).toBe(expected ?? undefined);
      if (i > 0) expect(fire.chatSession!.executionId).toBe(executionId);
      executionId = fire.chatSession!.executionId;
    }
    expect(q.getTrigger(trigger.id)).toMatchObject({ model: null, serviceTier: expected });
    expect(fake.sessions).toHaveLength(fires);
  });
});

it('honors an explicit model instead of replacing it with the first live model', async () => {
  const q = await import('@/lib/db/queries');
  const { dispatchRun } = await import('@/lib/runs/dispatch');
  const trigger = await schedule('workspace', 'manual', undefined);
  const explicit = q.updateTrigger(trigger.id, { model: bundledModel, effort: 'low' })!;
  const fire = await dispatchRun({ trigger: explicit, triggerKind: 'manual' });
  expect(fire.chatSession).toMatchObject({ model: bundledModel, effort: 'low', serviceTier: 'default' });
  expect(await finished(fire.run.id)).toMatchObject({ status: 'completed' });
  expect(fake.latest().ctx.config).toMatchObject({ model: bundledModel, effort: 'low', serviceTier: 'default' });
});

it('records unavailable speed as a failed run after discovery changes, without switching models or starting inference', async () => {
  const q = await import('@/lib/db/queries');
  const { clearHarnessModelCache } = await import('@/lib/harness/model-discovery');
  const { dispatchRun } = await import('@/lib/runs/dispatch');
  const trigger = await schedule('workspace', 'manual', 'ultrafast');
  getProvider('codex').listModels = async () => [
    { id: bundledModel, name: 'Now first', serviceTiers: serviceTiers.slice(0, 1) },
    { id: liveModel, name: 'Previously first', serviceTiers },
  ];
  clearHarnessModelCache('codex');
  const fire = await dispatchRun({ trigger, triggerKind: 'manual' });
  expect(fire.run).toMatchObject({ status: 'failed', errorCode: 'invalid_selection', errorMessage: expect.stringContaining('does not offer Ultrafast') });
  expect(fire.chatSession).toBeNull();
  expect(q.getTrigger(trigger.id)).toMatchObject({ lastRunStatus: 'failed', model: null, serviceTier: 'ultrafast' });
  expect(fake.sessions).toHaveLength(0);
  expect(q.listWorkspaceExecutions(trigger.workspaceId!)).toEqual([]);
});

it('keeps simultaneous first recurring fires in one execution after asynchronous model discovery', async () => {
  const q = await import('@/lib/db/queries');
  const { dispatchRun } = await import('@/lib/runs/dispatch');
  const trigger = await schedule('workspace', 'every', 'ultrafast');
  let release!: () => void;
  const turn = new Promise<void>(resolve => { release = resolve; });
  fake.onTurn(async () => { await turn; });
  try {
    const fires = await Promise.all([dispatchRun({ trigger, triggerKind: 'manual' }), dispatchRun({ trigger, triggerKind: 'manual' })]);
    expect(fires.map(fire => fire.run.status).sort()).toEqual(['queued', 'skipped']);
    const executionId = q.getTrigger(trigger.id)!.owningExecutionId;
    expect(executionId).toBeTruthy();
    expect(new Set(fires.map(fire => fire.run.executionId))).toEqual(new Set([executionId]));
    expect(q.listWorkspaceExecutions(trigger.workspaceId!)).toHaveLength(1);
    release();
    expect(await finished(fires.find(fire => fire.chatSession)!.run.id)).toMatchObject({ status: 'completed' });
  } finally {
    release();
  }
});
