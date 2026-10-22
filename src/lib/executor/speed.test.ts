import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProvider } from '@agentex/agent';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import type { OperationContext } from '@/lib/server/operation';

let home: TestHome;
let fake: FakeHarness;
const tiers = [
  { id: 'default', name: 'Standard', availability: 'available' as const },
  { id: 'fast', name: 'Fast', availability: 'unknown' as const },
];
const ctx: OperationContext = {
  headers: new Headers(), url: 'http://localhost', nextUrl: new URL('http://localhost'), signal: new AbortController().signal,
};

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-speed-' });
  fake = installFakeHarness('claude');
  getProvider('claude').listModels = async () => [
    { id: 'opus', name: 'Opus', serviceTiers: tiers, defaultServiceTier: 'fast' },
    { id: 'claude-opus-5-5', name: 'Opus 5.5', serviceTiers: tiers },
    { id: 'sonnet', name: 'Sonnet', serviceTiers: tiers.slice(0, 1) },
  ];
});
afterEach(async () => {
  const { _resetExecutorState } = await import('./adapter');
  _resetExecutorState();
  fake?.restore();
  await home?.cleanup();
});

describe('saved model speed reaches the harness', () => {
  it.each([null, 'default'])('initializes a fresh heartbeat to Normal with global speed %s and carries it through dispatch', async preference => {
    const q = await import('@/lib/db/queries');
    const { ensureHeartbeatTrigger, getHeartbeatConfig } = await import('@/lib/heartbeat/trigger');
    const { actions } = await import('@/lib/orchestrator/registry');
    const { dispatchRun } = await import('@/lib/runs/dispatch');
    q.setHomeDefaultSelection({ harness: 'claude', model: 'opus', variant: null, effort: 'medium', serviceTier: preference });
    const seeds = await Promise.all([ensureHeartbeatTrigger(), ensureHeartbeatTrigger(), ensureHeartbeatTrigger()]);
    expect(new Set(seeds.map(seed => seed!.id)).size).toBe(1);
    expect(seeds.every(seed => seed?.serviceTier === 'default')).toBe(true);
    await actions.find(action => action.name === 'update_heartbeat')!.handler({ remote: false }, { enabled: true } as never);
    expect((await getHeartbeatConfig()).serviceTier).toBe('default');
    const trigger = q.getTrigger(seeds[0]!.id)!;
    const fire = await dispatchRun({ trigger, triggerKind: 'manual' });
    await vi.waitFor(() => expect(q.getRun(fire.run.id)?.status).toBe('completed'), { timeout: 15_000 });
    expect(q.getChatSession(fire.chatSession!.id)?.serviceTier).toBe('default');
    expect(fake.latest().ctx.config?.serviceTier).toBe('default');
  });

  it('preserves a legacy heartbeat NULL through first read, enabling, and dispatch', async () => {
    const q = await import('@/lib/db/queries');
    const { HEARTBEAT_TRIGGER_ID, ensureHeartbeatTrigger } = await import('@/lib/heartbeat/trigger');
    const { actions } = await import('@/lib/orchestrator/registry');
    const { dispatchRun } = await import('@/lib/runs/dispatch');
    q.setHomeDefaultSelection({ harness: 'claude', model: 'opus', variant: null, effort: 'medium', serviceTier: 'default' });
    const legacy = q.createTrigger({ id: HEARTBEAT_TRIGGER_ID, name: 'Heartbeat', harness: 'claude', model: 'opus',
      prompt: 'Check in', kind: 'every', intervalSeconds: 3600, enabled: false, targetKind: 'orchestrator', serviceTier: null });
    expect((await ensureHeartbeatTrigger())?.serviceTier).toBeNull();
    await actions.find(action => action.name === 'update_heartbeat')!.handler({ remote: false }, { enabled: true } as never);
    const saved = q.getTrigger(legacy.id)!;
    expect(saved.serviceTier).toBeNull();
    const fire = await dispatchRun({ trigger: saved, triggerKind: 'manual' });
    await vi.waitFor(() => expect(q.getRun(fire.run.id)?.status).toBe('completed'), { timeout: 15_000 });
    expect(fake.latest().ctx.config?.serviceTier).toBeUndefined();
  });

  it('offers no initialized heartbeat speed when the selected model advertises no speed metadata', async () => {
    const q = await import('@/lib/db/queries');
    q.setHomeDefaultSelection({ harness: 'claude', model: 'opus', variant: null, effort: 'medium', serviceTier: null });
    getProvider('claude').listModels = async () => [{ id: 'opus', name: 'Opus' }];
    const { ensureHeartbeatTrigger } = await import('@/lib/heartbeat/trigger');
    expect((await ensureHeartbeatTrigger())?.serviceTier).toBeNull();
    expect(fake.sessions).toHaveLength(0);
  });

  it('preserves discovery metadata, validates selection, and defaults a new chat to Normal', async () => {
    const { resolveStartSelection } = await import('@/lib/harness/start-selection');
    const { getHarnessModels } = await import('@/lib/harness/model-discovery');
    expect((await getHarnessModels('claude')).models.find(model => model.id === 'opus')?.serviceTiers).toEqual(tiers);
    expect(await resolveStartSelection({ providerId: 'claude', model: 'opus' })).toMatchObject({ serviceTier: 'default' });
    expect(await resolveStartSelection({ providerId: 'claude', model: 'opus', serviceTier: 'fast' })).toMatchObject({ serviceTier: 'fast' });
    await expect(resolveStartSelection({ providerId: 'claude', model: 'sonnet', serviceTier: 'fast' })).rejects.toThrow('does not offer Fast');
  });

  it('applies Fast, recycles on a Normal selection, and resumes the same native conversation', async () => {
    const q = await import('@/lib/db/queries');
    const { dispatch } = await import('./adapter');
    const { PATCH } = await import('@/lib/server/operations/sessions/[id]');
    const chat = q.createChatSession({ type: 'orchestration', harness: 'claude', model: 'opus', serviceTier: 'fast' });
    await dispatch(chat.id, 'First turn');
    const original = fake.latest();
    expect(original.ctx.config?.serviceTier).toBe('fast');
    const native = q.getChatSession(chat.id)!.externalSessionId;

    const changed = await PATCH({ params: { id: chat.id }, body: { serviceTier: 'default' } }, ctx);
    expect(changed.status).toBe(200);
    expect(q.getChatSession(chat.id)?.serviceTier).toBe('default');
    await dispatch(chat.id, 'Second turn');
    expect(original.state).toBe('closed');
    expect(fake.sessions).toHaveLength(2);
    expect(fake.latest().ctx.config?.serviceTier).toBe('default');
    expect(fake.latest().ctx.sessionParams?.sessionId).toBe(native);
  });

  it('resets speed on an incompatible model change and rejects a direct unsupported selection', async () => {
    const q = await import('@/lib/db/queries');
    const { PATCH } = await import('@/lib/server/operations/sessions/[id]');
    const chat = q.createChatSession({ type: 'orchestration', harness: 'claude', model: 'opus', serviceTier: 'fast' });
    expect((await PATCH({ params: { id: chat.id }, body: { model: 'sonnet' } }, ctx)).status).toBe(200);
    expect(q.getChatSession(chat.id)).toMatchObject({ model: 'sonnet', serviceTier: 'default' });
    expect((await PATCH({ params: { id: chat.id }, body: { serviceTier: 'fast' } }, ctx)).status).toBe(400);
    expect(q.getChatSession(chat.id)?.serviceTier).toBe('default');
    expect(fake.sessions).toHaveLength(0);
  });

  it('preserves legacy native defaults until an explicit speed is selected', async () => {
    const q = await import('@/lib/db/queries');
    const { dispatch } = await import('./adapter');
    const chat = q.createChatSession({ type: 'orchestration', harness: 'claude', model: 'opus' });
    await dispatch(chat.id, 'Legacy turn');
    expect(fake.latest().ctx.config?.serviceTier).toBeUndefined();
    expect(q.getChatSession(chat.id)?.serviceTier).toBeNull();
  });

  it('rejects a saved unsupported speed at dispatch before opening a harness', async () => {
    const q = await import('@/lib/db/queries');
    const { dispatch } = await import('./adapter');
    const chat = q.createChatSession({ type: 'orchestration', harness: 'claude', model: 'sonnet', serviceTier: 'fast' });
    await expect(dispatch(chat.id, 'Must not run')).rejects.toThrow('does not offer Fast');
    expect(fake.sessions).toHaveLength(0);
  });

  it('retains speed in deliberate defaults, chat creation, and trigger actions', async () => {
    const q = await import('@/lib/db/queries');
    const { resolveStartSelection } = await import('@/lib/harness/start-selection');
    q.setHomeDefaultSelection({ harness: 'claude', model: 'opus', variant: null, effort: 'medium', serviceTier: 'fast' });
    expect(await resolveStartSelection({})).toMatchObject({ serviceTier: 'fast' });
    const { actions } = await import('@/lib/orchestrator/registry');
    const create = actions.find(action => action.name === 'create_trigger')!;
    const created = await create.handler({ remote: false }, {
      name: 'Speed test', prompt: 'Check in', targetKind: 'orchestrator', kind: 'manual', provider: 'claude', model: 'opus', serviceTier: 'fast',
    } as never) as { trigger: { id: string; serviceTier: string } };
    const trigger = created.trigger;
    expect(q.getTrigger(trigger.id)?.serviceTier).toBe('fast');
    const update = actions.find(action => action.name === 'update_trigger')!;
    await expect(update.handler({ remote: false }, { id: trigger.id, model: 'sonnet', serviceTier: 'fast' } as never)).rejects.toThrow('does not offer Fast');
    await update.handler({ remote: false }, { id: trigger.id, model: 'sonnet' } as never);
    expect(q.getTrigger(trigger.id)?.serviceTier).toBe('default');
  });

  it.each([
    { name: 'omitted speed', model: 'opus', speed: undefined, expected: 'default' },
    { name: 'NULL speed on a new schedule', model: 'opus', speed: null, expected: 'default' },
    { name: 'omitted model', model: undefined, speed: undefined, expected: 'default' },
    { name: 'omitted model with explicit Fast', model: undefined, speed: 'fast', expected: 'fast' },
    { name: 'explicit Normal', model: 'opus', speed: 'default', expected: 'default' },
    { name: 'explicit Fast', model: 'opus', speed: 'fast', expected: 'fast' },
    { name: 'a model without speed metadata', model: 'custom-no-speed', speed: undefined, expected: null },
  ])('initializes a new agent-created schedule with $name and carries its speed into inference', async ({ model, speed, expected }) => {
    const q = await import('@/lib/db/queries');
    const { actions } = await import('@/lib/orchestrator/registry');
    const { dispatchRun } = await import('@/lib/runs/dispatch');
    q.addCustomHarnessModel('claude', 'custom-no-speed');
    // Scheduled NULL models use the catalog fallback at dispatch, even if
    // the ordinary fresh-chat default names a different model without Fast.
    if (model === undefined) q.upsertHarnessSettings({ ...q.ensureHarnessSettings('claude'), defaultModel: 'sonnet' });
    const create = actions.find(action => action.name === 'create_trigger')!;
    const created = await create.handler({ remote: false }, {
      name: 'New schedule speed', prompt: 'Check in', targetKind: 'orchestrator', kind: 'manual', provider: 'claude', model,
      ...(speed === undefined ? {} : { serviceTier: speed }),
    } as never) as { trigger: { id: string } };
    const trigger = q.getTrigger(created.trigger.id)!;
    expect(trigger.serviceTier).toBe(expected);
    const fire = await dispatchRun({ trigger, triggerKind: 'manual' });
    await vi.waitFor(() => expect(q.getRun(fire.run.id)?.status).toBe('completed'), { timeout: 15_000 });
    expect(q.getChatSession(fire.chatSession!.id)?.serviceTier).toBe(expected);
    expect(fake.latest().ctx.config?.serviceTier).toBe(expected ?? undefined);
  });

  it('keeps a legacy NULL-speed schedule unchanged through edits and dispatch', async () => {
    const q = await import('@/lib/db/queries');
    const { actions } = await import('@/lib/orchestrator/registry');
    const { dispatchRun } = await import('@/lib/runs/dispatch');
    const trigger = q.createTrigger({ name: 'Legacy schedule', prompt: 'Check in', targetKind: 'orchestrator', kind: 'manual', harness: 'claude', model: 'opus' });
    await actions.find(action => action.name === 'update_trigger')!.handler({ remote: false }, { id: trigger.id, name: 'Legacy renamed' } as never);
    const saved = q.getTrigger(trigger.id)!;
    expect(saved.serviceTier).toBeNull();
    const fire = await dispatchRun({ trigger: saved, triggerKind: 'manual' });
    await vi.waitFor(() => expect(q.getRun(fire.run.id)?.status).toBe('completed'), { timeout: 15_000 });
    expect(q.getChatSession(fire.chatSession!.id)?.serviceTier).toBeNull();
    expect(fake.latest().ctx.config?.serviceTier).toBeUndefined();
  });

  it.each(['update_trigger', 'update_heartbeat'])('%s keeps compatible speed and resets incompatible speed to explicit Normal', async actionName => {
    const q = await import('@/lib/db/queries');
    const { actions } = await import('@/lib/orchestrator/registry');
    const heartbeat = await import('@/lib/heartbeat/trigger');
    const trigger = actionName === 'update_heartbeat' ? (await heartbeat.ensureHeartbeatTrigger())!
      : q.createTrigger({ name: 'Model speed change', targetKind: 'orchestrator', harness: 'claude', prompt: 'Check', kind: 'manual' });
    q.updateTrigger(trigger.id, { harness: 'claude', model: 'opus', serviceTier: 'fast' });
    const action = actions.find(action => action.name === actionName)!;
    const change = (input: Record<string, unknown>) => action.handler({ remote: false }, { id: trigger.id, ...input } as never);
    await change({ model: 'claude-opus-5-5' });
    expect(q.getTrigger(trigger.id)?.serviceTier).toBe('fast');
    await change({ model: 'sonnet' });
    expect(q.getTrigger(trigger.id)?.serviceTier).toBe('default');
    // Unrelated edits keep an untouched legacy NULL rather than retuning it.
    q.updateTrigger(trigger.id, { model: 'opus', serviceTier: null });
    await change(actionName === 'update_trigger' ? { name: 'Renamed' } : { instructions: 'Updated instructions' });
    expect(q.getTrigger(trigger.id)?.serviceTier).toBeNull();
  });
});

describe('AI-review speed snapshots', () => {
  async function source(automatic = false) {
    const q = await import('@/lib/db/queries');
    const { setWorkResultCapabilities } = await import('@/lib/work-results/capabilities');
    setWorkResultCapabilities({ handoffsEnabled: true, aiReviewEnabled: true });
    const workspace = automatic ? q.createWorkspace({ name: 'Review speed', cwd: home.root, isGit: false, reviewBeforeHandoff: true }) : null;
    const session = q.createChatSession({ harness: 'claude', type: 'content', model: 'opus', workspaceId: workspace?.id ?? null });
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'Write a brief memo.', createdAt: '2026-01-01T00:00:00Z' });
    const output = q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: 'A brief memo.', createdAt: '2026-01-01T00:01:00Z' })!;
    return { q, session, output, actor: { userId: 'local', source: 'human' as const } };
  }

  async function settleReview(id: string) {
    const q = await import('@/lib/db/queries');
    await vi.waitFor(() => {
      const review = q.getWorkResultAiReview(id)!;
      expect(review.runId).toBeTruthy();
      expect(['completed', 'failed']).toContain(q.getRun(review.runId!)?.status);
    }, { timeout: 15_000 });
    return q.getWorkResultAiReview(id)!;
  }

  it.each([
    { preference: null, model: 'opus', expected: 'default' },
    { preference: 'default', model: 'opus', expected: 'default' },
    { preference: 'fast', model: 'opus', expected: 'fast' },
    { preference: 'fast', model: 'sonnet', expected: 'default' },
    { preference: 'default', model: 'claude-pinned-no-speed', expected: null },
  ])('carries global $preference into a fresh $model review as $expected, retaining that snapshot on retry', async ({ preference, model, expected }) => {
    const { q, session, output, actor } = await source();
    const runtime = await import('@/lib/work-results/runtime');
    q.addCustomHarnessModel('claude', 'claude-pinned-no-speed');
    q.setHomeDefaultSelection({ harness: 'claude', model: 'opus', variant: null, effort: 'medium', serviceTier: preference });
    const result = q.createWorkResult(actor, { requestId: 'memo', body: output.content! }, { sourceChatSessionId: session.id, sourceEventId: output.id }).result;
    const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'speed-review', resultId: result.id, model });
    const review = await settleReview(requested.review.id);
    expect(review.selection.serviceTier).toBe(expected);
    expect(q.getChatSession(review.reviewerSessionId!)?.serviceTier).toBe(expected);
    expect(fake.sessions, q.getRun(review.runId!)?.errorMessage ?? 'Reviewer reached inference').toHaveLength(1);
    expect(fake.latest().ctx.config?.serviceTier).toBe(expected ?? undefined);
    q.setHomeDefaultSelection({ harness: 'claude', model: 'opus', variant: null, effort: 'medium', serviceTier: preference === 'fast' ? 'default' : 'fast' });
    const replay = await runtime.requestWorkResultAiReview(actor, { requestId: 'speed-review', resultId: result.id, model });
    expect(replay.review.selection).toEqual(review.selection);
    expect(fake.sessions).toHaveLength(1);
  });

  it('carries initialized speed through opt-in automatic review preparation, saving, and later dispatch', async () => {
    const { q, session, output } = await source(true);
    const automatic = await import('@/lib/work-results/automatic');
    q.setHomeDefaultSelection({ harness: 'claude', model: 'opus', variant: null, effort: 'medium', serviceTier: 'default' });
    const actor = { userId: 'local', source: 'ai' as const, sessionId: session.id };
    const automaticReview = await automatic.prepareAutomaticWorkResultReview(actor, session.id);
    expect(automaticReview).toBeTypeOf('function');
    const saved = q.createWorkResult(actor, { requestId: 'automatic-memo', body: output.content! }, { sourceEventId: output.id, automaticReview });
    const review = q.getWorkResult(saved.result.id)!.aiReviews[0];
    expect(review.selection.serviceTier).toBe('default');
    // A deliberate new global preference must not rewrite an already queued assignment.
    q.setHomeDefaultSelection({ harness: 'claude', model: 'opus', variant: null, effort: 'medium', serviceTier: 'fast' });
    await automatic.dispatchAutomaticWorkResultReviews(session.id);
    const completed = await settleReview(review.id);
    expect(q.getChatSession(completed.reviewerSessionId!)?.serviceTier).toBe('default');
    expect(fake.latest().ctx.config?.serviceTier).toBe('default');
  });

  it.each([false, true])('preserves legacy assignment speed and rejects a changed snapshot, tampered=%s', async tampered => {
    const { q, session, output, actor } = await source();
    const runtime = await import('@/lib/work-results/runtime');
    q.setHomeDefaultSelection({ harness: 'claude', model: 'opus', variant: null, effort: 'medium', serviceTier: 'default' });
    const saved = q.createWorkResult(actor, { requestId: 'old-memo', body: output.content! }, { sourceChatSessionId: session.id, sourceEventId: output.id });
    const detail = q.getWorkResult(saved.result.id)!;
    const scope = await runtime.captureWorkResultReviewScope(detail);
    const review = q.createWorkResultAiReview(actor, { requestId: 'saved-assignment', resultId: saved.result.id, brief: 'Inspect the original memo.', scope,
      selection: { harness: 'claude', model: 'opus', variant: null, effort: 'medium', ...(tampered ? { serviceTier: 'default' } : {}) },
      provenance: { method: 'fresh_session', independence: 'unknown' } }).review;
    const reviewerId = runtime.bindWorkResultReviewRuntime(actor, review, 'saved-assignment', detail);
    expect(q.getChatSession(reviewerId)?.serviceTier).toBe(tampered ? 'default' : null);
    if (tampered) q.updateChatSession(reviewerId, { serviceTier: 'fast' });
    await runtime.dispatchQueuedWorkResultOperations(reviewerId);
    const settled = await settleReview(review.id);
    if (tampered) {
      expect(fake.sessions).toHaveLength(0);
      expect(q.getRun(settled.runId!)?.errorMessage).toContain('saved reviewer selection');
    } else expect(fake.latest().ctx.config?.serviceTier).toBeUndefined();
  });
});
