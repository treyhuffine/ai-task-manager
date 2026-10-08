import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { WorkResultActor, WorkResultAiReviewRecord, WorkResultReviewScope } from '@/db/types';

const mock = vi.hoisted(() => ({
  live: new Set<string>(),
  abort: vi.fn(),
  dispatch: vi.fn(),
  hook: null as null | ((sessionId: string, prompt: string) => Promise<void>),
  beforeAdmission: null as null | (() => Promise<void>),
}));
vi.mock('@/lib/executor/adapter', () => ({
  dispatch: mock.dispatch, abort: mock.abort,
  isRunning: (id: string) => mock.live.has(id), hasBackgroundTasks: () => false,
  listBackgroundTaskIds: () => [],
}));
vi.mock('@/lib/harness/model-discovery', () => ({
  getHarnessModelCatalog: async (harness: string) => [{ id: harness === 'codex' ? 'gpt-5.5' : 'opus', supportedEfforts: ['low', 'medium', 'high'] }],
  resolveHarnessSelection: async (providerId: string, preferred: { model?: string | null; variant?: string | null; effort?: string | null }) => {
    if (preferred.model === 'missing') throw new Error('Requested model is unavailable');
    return { providerId, model: preferred.model ?? (providerId === 'codex' ? 'gpt-5.5' : 'opus'),
      variant: preferred.variant ?? null, effort: preferred.effort && ['low', 'medium', 'high'].includes(preferred.effort) ? preferred.effort : 'high' };
  },
}));
vi.mock('@/lib/harness/runtime', () => ({ getHarnessRuntime: async (harness: string) => ({ capabilities: {
  sessions: { supported: true }, planMode: { supported: true },
  mcp: { supported: harness !== 'codex' },
} }) }));
vi.mock('@/lib/orchestrator/harness-surface', () => ({ resolveCliCommand: () => 'ri' }));
// Runtime fixtures exercise source association and files, not asynchronous embeddings.
vi.mock('@/lib/embeddings/embed', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/embeddings/embed')>(),
  upsertEmbedding: vi.fn(async () => {}), deleteEmbedding: vi.fn(),
}));
vi.mock('@/lib/attachments/expand-markers', () => ({ expandMarkers: async (text: string) => text }));
vi.mock('@/lib/entity-refs/expand-markers', () => ({ expandEntityMarkers: (text: string) => text }));

describe('durable result runtime', () => {
  const actor: WorkResultActor = { userId: 'local', source: 'human' };
  let root: string;
  let previous: Record<string, string | undefined>;
  let q: typeof import('@/lib/db/queries');
  let runtime: typeof import('./runtime');
  let caps: typeof import('./capabilities');
  let release: (() => void) | undefined;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-result-runtime-'));
    previous = Object.fromEntries(['RI_ROOT', 'RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_MIRROR_DISABLED'].map((key) => [key, process.env[key]]));
    process.env.RI_ROOT = root;
    process.env.RI_DB_PATH = path.join(root, 'data.db');
    process.env.RI_CONFIG_DIR = path.join(root, '.config');
    process.env.RI_MIRROR_DISABLED = '1';
    vi.resetModules();
    vi.clearAllMocks();
    mock.live.clear();
    mock.hook = null;
    mock.beforeAdmission = null;
    const active = (globalThis as unknown as Record<symbol, Set<string>>)[Symbol.for('ri.process.work-results.dispatches')];
    active?.clear();
    (globalThis as unknown as Record<symbol, Set<string>>)[Symbol.for('ri.process.work-results.session-dispatches')]?.clear();
    q = await import('@/lib/db/queries');
    runtime = await import('./runtime');
    caps = await import('./capabilities');
    caps.setWorkResultCapabilities({ handoffsEnabled: true, aiReviewEnabled: true });
    mock.dispatch.mockImplementation(async (sessionId: string, prompt: string, options: { resultOperationRunId: string }) => {
      await mock.beforeAdmission?.();
      if (!await runtime.verifyQueuedWorkResultReviewScope(options.resultOperationRunId)
        || !runtime.admitWorkResultOperationDispatch(options.resultOperationRunId, sessionId)) throw new Error('Admission refused');
      mock.live.add(sessionId);
      try { await mock.hook?.(sessionId, prompt); }
      finally { mock.live.delete(sessionId); }
    });
  });

  afterEach(async () => {
    release?.();
    release = undefined;
    await flush();
    (await import('@/lib/db')).resetDb();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function flush() { await new Promise((resolve) => setTimeout(resolve, 15)); }

  function seed() {
    const session = q.createChatSession({ harness: 'claude', type: 'content' });
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'Produce a research memo about the sources.', createdAt: '2026-01-01T00:00:00Z' });
    q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: 'Here are the findings.', createdAt: '2026-01-01T00:00:30Z' });
    const source = q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: 'Durable research findings.', createdAt: '2026-01-01T00:01:00Z' })!;
    const result = q.createWorkResult(actor, { requestId: 'saved', body: source.content! }, { sourceChatSessionId: session.id, sourceEventId: source.id }).result;
    return { session, source, result };
  }

  function waitForReview() {
    const wait = new Promise<void>((resolve) => { release = resolve; });
    mock.hook = async () => wait;
  }

  it('snapshots scoped guidance into preparation and review without changing an existing saved answer', async () => {
    const { session, source, result } = seed();
    const workspace = q.createWorkspace({ name: 'Research', cwd: root, isGit: false,
      workResultGuidance: 'AGENT HANDOFF: Identify inaccessible sources.' });
    q.updateChatSession(session.id, { workspaceId: workspace.id });
    q.updateUserState({ workResultGuidance: 'SHARED HANDOFF: Include verification and limitations.' });
    mock.live.add(session.id);
    const prepared = await runtime.prepareWorkResultHandoff(actor, {
      requestId: 'scoped-preparation', sourceChatSessionId: session.id,
    });
    const prompt = q.getChatEventById(prepared.messageId!)!.content!;
    expect(prompt).toContain('SHARED HANDOFF: Include verification and limitations.');
    expect(prompt).toContain('AGENT HANDOFF: Identify inaccessible sources.');
    expect(prompt).toContain('Finish by calling report_result');
    expect(q.getWorkResult(result.id)!.result.body).toBe(source.content);
    mock.live.delete(session.id);
    waitForReview();
    const reviewed = await runtime.requestWorkResultAiReview(actor, { requestId: 'scoped-review', resultId: result.id });
    const brief = q.getWorkResultAiReview(reviewed.review.id)!.brief!;
    expect(brief).toContain('SHARED HANDOFF: Include verification and limitations.');
    expect(brief).toContain('AGENT HANDOFF: Identify inaccessible sources.');
    q.updateUserState({ workResultGuidance: 'SHARED HANDOFF: Changed after queue.' });
    q.updateWorkspace(workspace.id, { workResultGuidance: null });
    expect(q.getWorkResultAiReview(reviewed.review.id)!.brief).toBe(brief);
    expect(q.getChatEventById(prepared.messageId!)!.content).toBe(prompt);
    expect(q.getWorkResult(result.id)!.result.body).toBe(source.content);
    mock.live.add(session.id);
    const update = await runtime.prepareWorkResultHandoff(actor, {
      requestId: 'scoped-update', sourceChatSessionId: session.id, resultId: result.id,
    });
    const updatePrompt = q.getChatEventById(update.messageId!)!.content!;
    expect(updatePrompt).toContain('SHARED HANDOFF: Changed after queue.');
    expect(updatePrompt).not.toContain('AGENT HANDOFF: Identify inaccessible sources.');
    expect(updatePrompt).toContain(`supersedes_id ${result.id}`);
    expect(q.getWorkResult(result.id)!.result.body).toBe(source.content);
    mock.live.delete(session.id);
  });

  it('persists one fresh reviewer and an exact retained brief for concurrent retries', async () => {
    const { session, result } = seed();
    waitForReview();
    const [first, second] = await Promise.all([
      runtime.requestWorkResultAiReview(actor, { requestId: 'review', resultId: result.id }),
      runtime.requestWorkResultAiReview(actor, { requestId: 'review', resultId: result.id }),
    ]);
    await flush();
    expect(first.review.id).toBe(second.review.id);
    expect(mock.dispatch).toHaveBeenCalledTimes(1);
    const review = q.getWorkResultAiReview(first.review.id)!;
    expect(review.reviewerSessionId).not.toBe(session.id);
    const reviewer = q.getChatSession(review.reviewerSessionId!)!;
    expect(reviewer.surfaceKind).toBe('result_review');
    expect(reviewer.permissionMode).toBe('plan');
    expect(q.listChatEvents(reviewer.id).find((event) => event.source === 'user')?.content).toBe(review.brief);
    expect(review.brief).toContain('Produce a research memo');
    expect(review.brief).toContain('Durable research findings');
    expect(review.brief).toContain('"${RI_SESSION_CLI:-ri}" agent report_result_review');
    expect(review.brief).not.toContain('Here are the findings.');
    expect(q.listChatSessions().map((row) => row.id)).not.toContain(reviewer.id);
    expect(q.listChatSessions({ includeInternal: true }).map((row) => row.id)).toContain(reviewer.id);
    expect(q.listWorkResultReviewAttentionSessions().map((row) => row.sessionId)).toContain(reviewer.id);
  });

  it('binds a reused conversation review to its producing request and retained criteria files', async () => {
    const { session } = seed();
    const file = await (await import('@/lib/attachments/save')).saveAttachment({
      data: Buffer.from('Explain rollback without losing rows.'), originalName: 'criteria.txt', mimeType: 'text/plain',
    });
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user',
      content: `Write a migration safety memo using [[file:${file.fileName}]].`, attachments: [file], createdAt: '2026-01-02T00:00:00Z' });
    const output = q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent',
      content: 'Migration safety memo.', createdAt: '2026-01-02T00:01:00Z' })!;
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'Now draft a poem.', createdAt: '2026-01-03T00:00:00Z' });
    const result = q.createWorkResult(actor, { requestId: 'migration-memo', body: output.content! },
      { sourceChatSessionId: session.id, sourceEventId: output.id }).result;
    waitForReview();
    const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'migration-review', resultId: result.id });
    expect(requested.review.brief).toContain('Write a migration safety memo');
    expect(requested.review.brief).not.toContain('Produce a research memo');
    expect(requested.review.brief).not.toContain('Now draft a poem');
    expect(requested.review.scope.requested.attachments.map((attachment) => attachment.file_name)).toContain(file.fileName);
  });

  it('waits for the shared API lease and rechecks a disabled queue when capacity returns', async () => {
    const { result } = seed();
    const lease = await import('@/lib/runs/rate-lease');
    const capacity = lease.getApiLeaseStats().capacity;
    await Promise.all(Array.from({ length: capacity }, () => lease.acquireApiLease()));
    try {
      const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'capacity-review', resultId: result.id });
      await vi.waitFor(() => expect(lease.getApiLeaseStats().waiters).toBe(1));
      expect(q.getWorkResultAiReview(requested.review.id)?.status).toBe('queued');
      expect(mock.dispatch).not.toHaveBeenCalled();
      caps.setWorkResultCapabilities({ aiReviewEnabled: false });
      runtime.reconcileWorkResultCapabilities();
      expect(q.getWorkResultAiReview(requested.review.id)?.status).toBe('cancelled');
    } finally {
      for (let count = 0; count < capacity; count++) lease.releaseApiLease();
    }
    await vi.waitFor(() => expect(lease.getApiLeaseStats().inflight).toBe(0));
    expect(mock.live.size).toBe(0);
  });

  it('replays resolved selection after defaults and gates change, and conflicts on changed explicit intent', async () => {
    const { result } = seed();
    waitForReview();
    const first = await runtime.requestWorkResultAiReview(actor, { requestId: 'review', resultId: result.id, model: 'opus' });
    q.updateUserState({ defaultHarness: 'codex', defaultModel: 'gpt-5.5', defaultEffort: 'low' });
    caps.setWorkResultCapabilities({ handoffsEnabled: false, aiReviewEnabled: false });
    const replay = await runtime.requestWorkResultAiReview(actor, { requestId: 'review', resultId: result.id, model: 'opus' });
    expect(replay.review.selection).toEqual(first.review.selection);
    await expect(runtime.requestWorkResultAiReview(actor, { requestId: 'review', resultId: result.id, model: 'missing' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(runtime.requestWorkResultAiReview(actor, { requestId: 'new', resultId: result.id })).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('rejects unsupported explicit effort instead of silently ignoring it', async () => {
    const { result } = seed();
    await expect(runtime.requestWorkResultAiReview(actor, { requestId: 'review', resultId: result.id, effort: 'ultra' })).rejects.toMatchObject({ code: 'unsupported' });
    expect(q.listActiveWorkResultAiReviews()).toHaveLength(0);
  });

  it('rejects an unavailable inherited effort instead of launching with a different displayed tuple', async () => {
    const { result } = seed();
    q.updateUserState({ defaultHarness: 'claude', defaultModel: 'opus', defaultEffort: 'ultra' });
    await expect(runtime.requestWorkResultAiReview(actor, { requestId: 'inherited-effort', resultId: result.id }))
      .rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('Effort ultra is unavailable') });
    expect(mock.dispatch).not.toHaveBeenCalled();
    expect(q.getWorkResult(result.id)?.aiReviews).toHaveLength(0);
    expect(q.getUserState()?.defaultEffort).toBe('ultra');
    const deliberate = await runtime.requestWorkResultAiReview(actor, { requestId: 'compatible-effort', resultId: result.id, effort: 'high' });
    expect(deliberate.review.selection.effort).toBe('high');
    expect(q.getUserState()?.defaultEffort).toBe('ultra');
  });

  it('inherits a taskless producing agent reviewer tuple without changing authoring or normal defaults', async () => {
    const { session, result } = seed();
    const workspace = q.createWorkspace({ name: 'Research', cwd: root, isGit: false,
      reviewDefaults: { harness: 'codex', model: 'gpt-5.5', effort: 'low' } });
    q.updateChatSession(session.id, { workspaceId: workspace.id });
    q.updateUserState({ defaultHarness: 'claude', defaultModel: 'opus', defaultEffort: 'medium' });
    waitForReview();
    const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'agent-defaults', resultId: result.id });
    expect(requested.review.selection).toMatchObject({ harness: 'codex', model: 'gpt-5.5', effort: 'low', explicit: {} });
    expect(q.getWorkResult(result.id)?.taskIds).toEqual([]);
    expect(q.getChatSession(session.id)?.harness).toBe('claude');
    expect(q.getUserState()).toMatchObject({ defaultHarness: 'claude', defaultModel: 'opus', defaultEffort: 'medium' });
    q.updateWorkspace(workspace.id, { reviewDefaults: { harness: 'claude', model: 'opus', effort: 'high' } });
    caps.setWorkResultCapabilities({ handoffsEnabled: false });
    const replay = await runtime.requestWorkResultAiReview(actor, { requestId: 'agent-defaults', resultId: result.id });
    expect(replay.review.selection).toEqual(requested.review.selection);
  });

  it('per-request harness overrides exclude another harness agent model, variant and effort', async () => {
    const { session, result } = seed();
    const workspace = q.createWorkspace({ name: 'Research', cwd: root, isGit: false,
      reviewDefaults: { harness: 'codex', model: 'gpt-5.5', variant: 'codex-only', effort: 'low' } });
    q.updateChatSession(session.id, { workspaceId: workspace.id });
    q.updateUserState({ defaultHarness: 'claude', defaultModel: 'opus', defaultEffort: 'medium' });
    waitForReview();
    const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'one-review', resultId: result.id, harness: 'claude' });
    expect(requested.review.selection).toMatchObject({ harness: 'claude', model: 'opus', variant: null, effort: 'medium', explicit: { harness: 'claude' } });
    expect(q.getWorkspace(workspace.id)?.reviewDefaults).toEqual(workspace.reviewDefaults);
  });

  it('preserves an unavailable saved agent choice and requires a deliberate compatible override', async () => {
    const { session, result } = seed();
    const workspace = q.createWorkspace({ name: 'Research', cwd: root, isGit: false,
      reviewDefaults: { harness: 'claude', model: 'opus', effort: 'ultra' } });
    q.updateChatSession(session.id, { workspaceId: workspace.id });
    await expect(runtime.requestWorkResultAiReview(actor, { requestId: 'unavailable-agent', resultId: result.id }))
      .rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('Effort ultra is unavailable') });
    expect(mock.dispatch).not.toHaveBeenCalled();
    waitForReview();
    const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'compatible-agent', resultId: result.id, effort: 'high' });
    expect(requested.review.selection.effort).toBe('high');
    expect(q.getWorkspace(workspace.id)?.reviewDefaults?.effort).toBe('ultra');
  });

  it('does not infer an agent from linked tasks when the producing context has none', async () => {
    const { result } = seed();
    const unrelated = q.createWorkspace({ name: 'Unrelated', cwd: root, isGit: false,
      reviewDefaults: { harness: 'codex', model: 'gpt-5.5', effort: 'low' } });
    const task = q.createTask({ title: 'Related task', workspaceId: unrelated.id });
    const detail = { ...q.getWorkResult(result.id)!, taskIds: [task.id] };
    const { getAssociatedWorkResultWorkspace } = await import('./reviewer-preferences');
    expect(getAssociatedWorkResultWorkspace(detail)).toBeNull();
    q.updateUserState({ defaultHarness: 'claude', defaultModel: 'opus', defaultEffort: 'medium' });
    const selection = await runtime.resolveWorkResultReviewerSelection({ requestId: 'normal', resultId: result.id }, root, detail);
    expect(selection).toMatchObject({ harness: 'claude', model: 'opus', effort: 'medium' });
  });

  it('recovers agent inheritance from the owned producing execution after its chat is pruned', async () => {
    const { result } = seed();
    const workspace = q.createWorkspace({ name: 'Producing agent', cwd: root, isGit: false,
      reviewDefaults: { harness: 'codex', model: 'gpt-5.5', effort: 'low' } });
    const execution = q.createExecution({ workspaceId: workspace.id });
    const { getWorkResultSourceWorkspace } = await import('./reviewer-preferences');
    expect(getWorkResultSourceWorkspace(actor.userId, 'pruned-chat', execution.id)?.id).toBe(workspace.id);
    const selection = await runtime.resolveWorkResultReviewerSelection({ requestId: 'recover-agent', resultId: result.id }, root,
      getWorkResultSourceWorkspace(actor.userId, 'pruned-chat', execution.id)!);
    expect(selection).toMatchObject({ harness: 'codex', model: 'gpt-5.5', effort: 'low' });
    expect(getWorkResultSourceWorkspace('another-owner', null, execution.id)).toBeNull();
  });

  it('recovers an exact historical saved source beyond the latest hundred without preparing another handoff', async () => {
    const { session, source, result } = seed();
    const author = { userId: 'local', source: 'ai' as const, sessionId: session.id };
    q.createWorkResult(author, { requestId: 'successor', body: 'A meaningfully updated memo.', supersedesId: result.id });
    for (let count = 0; count < 101; count++) q.createWorkResult(actor,
      { requestId: `unrelated-${count}`, body: `Other saved output ${count}.` }, { sourceChatSessionId: session.id });
    const recovered = await runtime.prepareWorkResultHandoff(actor, {
      requestId: 'recover-historical', sourceChatSessionId: session.id, sourceEventId: source.id,
    });
    expect(recovered.resultId).toBe(result.id);
    expect(recovered.statusReason).toBe('handoff_exists');
    expect(recovered.runId).toBeNull();
    expect(mock.dispatch).not.toHaveBeenCalled();
    expect(q.listWorkResultOperationRuns()).toHaveLength(0);
  });

  it('rechecks the gate at provider admission and never replays a cancelled queue after re-enable', async () => {
    const { result } = seed();
    const wait = new Promise<void>((resolve) => { release = resolve; });
    mock.beforeAdmission = async () => wait;
    const reviewerRan = vi.fn();
    mock.hook = async () => { reviewerRan(); };
    const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'review', resultId: result.id });
    await flush();
    expect(q.getWorkResultAiReview(requested.review.id)?.status).toBe('queued');
    caps.setWorkResultCapabilities({ aiReviewEnabled: false });
    runtime.reconcileWorkResultCapabilities();
    caps.setWorkResultCapabilities({ aiReviewEnabled: true });
    release?.(); release = undefined;
    await flush();
    expect(reviewerRan).not.toHaveBeenCalled();
    expect(q.getWorkResultAiReview(requested.review.id)?.status).toBe('cancelled');
    expect(q.getWorkResultAiReview(requested.review.id)?.statusReason).toBe('feature_disabled');
    await runtime.dispatchQueuedWorkResultOperations();
    expect(mock.dispatch).toHaveBeenCalledTimes(1);
  });

  it('cancels a queued preparation without aborting its producing session', async () => {
    const { session } = seed();
    mock.live.add(session.id);
    const source = q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: 'Unpackaged answer.' })!;
    const request = await runtime.prepareWorkResultHandoff(actor, { requestId: 'prepare', sourceChatSessionId: session.id, sourceEventId: source.id });
    const cancelled = runtime.cancelWorkResultPreparation(actor, request.messageId!);
    expect(cancelled.status).toBe('cancelled');
    expect(mock.abort).not.toHaveBeenCalled();
    mock.live.delete(session.id);
    await runtime.dispatchQueuedWorkResultOperations(session.id);
    expect(mock.dispatch).not.toHaveBeenCalled();
  });

  it('keeps the exact prepared feedback payload after its source conversation is pruned', async () => {
    const { session, result } = seed();
    mock.live.add(session.id);
    const sent = await runtime.sendWorkResultFeedback(actor, { requestId: 'feedback', resultId: result.id,
      disposition: 'changes_requested', note: 'Separate assumptions from facts.' });
    const event = q.getChatEventById(sent.review.feedbackMessageId!)!;
    const run = q.getRun(sent.delivery!.runId!)!;
    (await import('@/lib/db')).getRawDb().prepare('DELETE FROM chat_sessions WHERE id = ?').run(session.id);
    expect(q.getChatEventById(event.id)).toBeNull();
    expect(q.getRun(run.id)?.triggerPayload).toMatchObject({ content: event.content });
    expect(q.getWorkResult(result.id)?.reviews[0].note).toBe('Separate assumptions from facts.');
    caps.setWorkResultCapabilities({ handoffsEnabled: false });
    const replay = await runtime.sendWorkResultFeedback(actor, { requestId: 'feedback', resultId: result.id,
      disposition: 'changes_requested', note: 'Separate assumptions from facts.' });
    expect(replay.review.id).toBe(sent.review.id);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.delivery?.status).toBe('unavailable');
    await runtime.dispatchQueuedWorkResultOperations();
    expect(q.getRun(run.id)?.statusReason).toBe('target_unavailable');
  });

  it('replays a saved preparation intent after its source is pruned and the feature disabled', async () => {
    const { session } = seed();
    mock.live.add(session.id);
    const output = q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: 'Unpackaged useful output.' })!;
    const input = { requestId: 'pruned-preparation', sourceChatSessionId: session.id, sourceEventId: output.id };
    const first = await runtime.prepareWorkResultHandoff(actor, input);
    (await import('@/lib/db')).getRawDb().prepare('DELETE FROM chat_sessions WHERE id = ?').run(session.id);
    caps.setWorkResultCapabilities({ handoffsEnabled: false });
    runtime.reconcileWorkResultCapabilities();
    const replay = await runtime.prepareWorkResultHandoff(actor, input);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.runId).toBe(first.runId);
    expect(replay.messageId).toBe(first.messageId);
    expect(replay.status).toBe('cancelled');
    expect(mock.dispatch).not.toHaveBeenCalled();
  });

  it('marks a successful turn without a committed report as missing_report', async () => {
    const { result } = seed();
    const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'review', resultId: result.id });
    await flush();
    const review = q.getWorkResultAiReview(requested.review.id)!;
    expect(review.status).toBe('failed');
    expect(review.statusReason).toBe('missing_report');
    expect(q.getRun(review.runId!)?.status).toBe('failed');
    await runtime.dispatchQueuedWorkResultOperations();
    expect(mock.dispatch).toHaveBeenCalledTimes(1);
  });

  it('allows only the admitted reviewer to complete after disable, and retains its report', async () => {
    const { result } = seed();
    waitForReview();
    const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'review', resultId: result.id });
    await flush();
    const review = q.getWorkResultAiReview(requested.review.id)!;
    caps.setWorkResultCapabilities({ handoffsEnabled: false, aiReviewEnabled: false });
    runtime.reconcileWorkResultCapabilities();
    expect(q.getWorkResultAiReview(review.id)?.status).toBe('running');
    const completed = q.reportWorkResultAiReview({ userId: 'local', source: 'ai', sessionId: review.reviewerSessionId },
      { requestId: 'review:report', reviewId: review.id, body: 'No actionable findings. I inspected the retained sources and memo. The live source links were unavailable.' },
      { attachments: [], capturedAt: new Date().toISOString(), drift: null });
    expect(completed.review.status).toBe('completed');
    release?.(); release = undefined;
    await flush();
    expect(q.getWorkResultAiReview(review.id)?.reportResultId).toBe(completed.report.id);
    expect(q.getWorkResult(completed.report.id)).toBeTruthy();
    expect(q.listWorkResults().map((row) => row.id)).not.toContain(completed.report.id);
  });

  it('records provider-observed model separately and never promotes requested effort to applied effort', async () => {
    const { result } = seed();
    waitForReview();
    const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'review', resultId: result.id, model: 'opus', effort: 'high' });
    await flush();
    const review = q.getWorkResultAiReview(requested.review.id)!;
    expect(runtime.observeWorkResultReviewProvenance(review).observedModel).toBeNull();
    q.insertChatEvent({ sessionId: review.reviewerSessionId!, role: 'system', source: 'system',
      raw: { model: 'claude-opus-provider-actual' } });
    const observed = runtime.observeWorkResultReviewProvenance(q.getWorkResultAiReview(review.id)!);
    expect(observed.observedModel).toBe('claude-opus-provider-actual');
    expect(observed.observedEffort).toBeNull();
    expect(q.getWorkResultAiReview(review.id)?.selection.effort).toBe('high');
    expect(observed.method).toBe('fresh_session');
    expect(observed.limitations?.[0]).toContain('no supported native');
  });

  it('cancels only the dedicated reviewer and never resurrects it with a late report', async () => {
    const { session, result } = seed();
    waitForReview();
    const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'review', resultId: result.id });
    await flush();
    const review = q.getWorkResultAiReview(requested.review.id)!;
    await runtime.cancelWorkResultAiReview(actor, review.id);
    expect(mock.abort).toHaveBeenCalledWith(review.reviewerSessionId);
    expect(mock.abort).not.toHaveBeenCalledWith(session.id);
    expect(() => q.reportWorkResultAiReview({ userId: 'local', source: 'ai', sessionId: review.reviewerSessionId },
      { requestId: 'late', reviewId: review.id, body: 'Late findings' })).toThrow('not running');
    expect(q.getWorkResultAiReview(review.id)?.status).toBe('cancelled');
  });

  it('keeps operational run cancellation distinct from a provider failure', async () => {
    const { result } = seed();
    mock.hook = async (sessionId) => {
      const review = q.getWorkResultAiReviewForSession(sessionId)!;
      q.transitionWorkResultOperationRun(review.runId!, ['running'], 'cancelled', { statusReason: 'execution_stopped' });
      throw new Error('The provider was interrupted.');
    };
    const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'stopped-review', resultId: result.id });
    await vi.waitFor(() => expect(q.getWorkResultAiReview(requested.review.id)?.status).toBe('cancelled'));
    expect(q.getWorkResultAiReview(requested.review.id)?.statusReason).toBe('runtime_cancelled');
  });

  it('cancels queued preparation at disable and never stops or silently replays authoring', async () => {
    const { session, source } = seed();
    mock.live.add(session.id);
    const prep = await runtime.prepareWorkResultHandoff(actor, { requestId: 'prep', sourceChatSessionId: session.id, sourceEventId: source.id });
    // This selected output already has a handoff, so no preparation is necessary.
    expect(prep.statusReason).toBe('handoff_exists');
    const output = q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: 'Another useful answer.' })!;
    const queued = await runtime.prepareWorkResultHandoff(actor, { requestId: 'prep-new', sourceChatSessionId: session.id, sourceEventId: output.id });
    const same = await runtime.prepareWorkResultHandoff(actor, { requestId: 'second-click', sourceChatSessionId: session.id, sourceEventId: output.id });
    expect(same.messageId).toBe(queued.messageId);
    caps.setWorkResultCapabilities({ handoffsEnabled: false });
    runtime.reconcileWorkResultCapabilities();
    expect(q.getRun(queued.runId!)?.status).toBe('cancelled');
    caps.setWorkResultCapabilities({ handoffsEnabled: true });
    mock.live.delete(session.id);
    await runtime.dispatchQueuedWorkResultOperations(session.id);
    await flush();
    expect(mock.dispatch).not.toHaveBeenCalled();
    expect(mock.abort).not.toHaveBeenCalled();
    expect(q.getChatSession(session.id)?.status).toBe('active');
  });

  it('keeps saved feedback delivery alive when handoffs are disabled', async () => {
    const { session, result } = seed();
    mock.live.add(session.id);
    const sent = await runtime.sendWorkResultFeedback(actor, { requestId: 'feedback', resultId: result.id,
      disposition: 'changes_requested', note: 'Please distinguish inference from verified sources.' });
    expect(sent.delivery?.status).toBe('queued');
    const event = q.getChatEventById(sent.review.feedbackMessageId!)!;
    expect(event.content).toContain(result.id);
    expect(event.content).toContain('Please distinguish inference');
    caps.setWorkResultCapabilities({ handoffsEnabled: false });
    runtime.reconcileWorkResultCapabilities();
    expect(q.getRun(sent.delivery!.runId!)?.status).toBe('queued');
    mock.live.delete(session.id);
    await runtime.dispatchQueuedWorkResultOperations(session.id);
    await flush();
    expect(mock.dispatch).toHaveBeenCalledTimes(1);
    const replay = await runtime.sendWorkResultFeedback(actor, { requestId: 'feedback', resultId: result.id,
      disposition: 'changes_requested', note: 'Please distinguish inference from verified sources.' });
    expect(replay.review.id).toBe(sent.review.id);
    expect(q.getChatEventById(sent.review.feedbackMessageId!)?.content).toBe(event.content);
    expect(mock.dispatch).toHaveBeenCalledTimes(1);
  });

  it('retains queued feedback without bypassing an explicit authoring Stop', async () => {
    const { session, result } = seed();
    mock.live.add(session.id);
    const sent = await runtime.sendWorkResultFeedback(actor, { requestId: 'stop-feedback', resultId: result.id,
      disposition: 'changes_requested', note: 'Clarify the evidence.' });
    runtime.stopQueuedWorkResultFeedbackForSession(session.id);
    mock.live.delete(session.id);
    await runtime.dispatchQueuedWorkResultOperations(session.id);
    expect(mock.dispatch).not.toHaveBeenCalled();
    expect(runtime.getWorkResultFeedbackDelivery(actor, sent.review)).toMatchObject({
      status: 'failed', statusReason: 'authoring_stopped', canRetry: true,
    });
    expect(q.getWorkResult(result.id)?.reviews[0].note).toBe('Clarify the evidence.');
    expect(q.getChatEventById(sent.review.feedbackMessageId!)?.content).toContain('Clarify the evidence.');
  });

  it('saves feedback while an authoring destination is archived without dispatching or substituting a chat', async () => {
    const { session, result } = seed();
    q.archiveChatSession(session.id);
    const sent = await runtime.sendWorkResultFeedback(actor, { requestId: 'archived-feedback', resultId: result.id,
      disposition: 'changes_requested', note: 'Clarify the evidence.' });
    await flush();
    expect(q.getWorkResult(result.id)?.reviews[0].note).toBe('Clarify the evidence.');
    expect(q.getRun(sent.delivery!.runId!)?.statusReason).toBe('target_unavailable');
    expect(q.getChatEventById(sent.review.feedbackMessageId!)?.content).toContain('Clarify the evidence.');
    expect(mock.dispatch).not.toHaveBeenCalled();
    expect(q.getChatSession(session.id)?.status).toBe('archived');
  });

  it('deliberately retries unadmitted feedback with its same exact message while handoffs are disabled', async () => {
    const { session, result } = seed();
    q.archiveChatSession(session.id);
    const sent = await runtime.sendWorkResultFeedback(actor, { requestId: 'retry-feedback', resultId: result.id,
      disposition: 'changes_requested', note: 'Clarify the evidence.' });
    await flush();
    const before = q.getChatEventById(sent.review.feedbackMessageId!)!;
    expect(runtime.getWorkResultFeedbackDelivery(actor, sent.review)?.canRetry).toBe(true);
    caps.setWorkResultCapabilities({ handoffsEnabled: false });
    q.unarchiveChatSession(session.id);
    await runtime.retryWorkResultFeedback(actor, { resultId: result.id, reviewId: sent.review.id });
    await flush();
    expect(mock.dispatch).toHaveBeenCalledTimes(1);
    expect(q.getChatEventById(before.id)?.content).toBe(before.content);
    expect(q.getWorkResult(result.id)?.reviews).toHaveLength(1);
    expect(runtime.getWorkResultFeedbackDelivery(actor, sent.review)?.status).toBe('completed');
  });

  it('does not automatically retry feedback whose admitted delivery is uncertain', async () => {
    const { result } = seed();
    waitForReview();
    const sent = await runtime.sendWorkResultFeedback(actor, { requestId: 'uncertain-feedback', resultId: result.id,
      disposition: 'changes_requested', note: 'Clarify the evidence.' });
    await flush();
    q.transitionWorkResultOperationRun(sent.delivery!.runId!, ['running'], 'failed', { statusReason: 'delivery_uncertain' });
    expect(runtime.getWorkResultFeedbackDelivery(actor, sent.review)?.canRetry).toBe(false);
    await expect(runtime.retryWorkResultFeedback(actor, { resultId: result.id, reviewId: sent.review.id })).rejects.toMatchObject({ code: 'conflict' });
    expect(mock.dispatch).toHaveBeenCalledTimes(1);
  });

  it('records admitted feedback runtime failure as uncertain without a false completed delivery', async () => {
    const { result } = seed();
    mock.hook = async () => { throw new Error('Provider interrupted after message submission.'); };
    const sent = await runtime.sendWorkResultFeedback(actor, { requestId: 'failed-feedback', resultId: result.id,
      disposition: 'changes_requested', note: 'Clarify the evidence.' });
    await vi.waitFor(() => expect(runtime.getWorkResultFeedbackDelivery(actor, sent.review)?.statusReason).toBe('delivery_uncertain'));
    expect(runtime.getWorkResultFeedbackDelivery(actor, sent.review)?.canRetry).toBe(false);
    expect(q.getWorkResult(result.id)?.reviews[0].note).toBe('Clarify the evidence.');
  });

  it('commits only the strict assigned host completion envelope on a non-MCP reviewer', async () => {
    const { session, result } = seed();
    waitForReview();
    const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'codex-review', resultId: result.id, harness: 'codex' });
    await flush();
    const review = q.getWorkResultAiReview(requested.review.id)!;
    expect(review.brief).toContain('ri_result_review_report');
    expect(review.brief).toContain('Do not run the CLI or make a network request');
    expect(review.brief).not.toContain('"${RI_SESSION_CLI:-ri}" agent report_result_review');
    const envelope = { ri_result_review_report: 'v1', request_id: 'codex-review:report', review_id: review.id,
      body: 'No actionable findings. Inspected the retained memo. The original sources could not be verified.' };
    const text = JSON.stringify(envelope);
    expect(await runtime.completeWorkResultReviewFromTurn(session.id, text)).toBe(false);
    expect(await runtime.completeWorkResultReviewFromTurn(review.reviewerSessionId!, 'Ordinary final answer')).toBe(false);
    expect(await runtime.completeWorkResultReviewFromTurn(review.reviewerSessionId!, `\`\`\`json\n${text}\n\`\`\``)).toBe(false);
    expect(await runtime.completeWorkResultReviewFromTurn(review.reviewerSessionId!, JSON.stringify({ ...envelope, review_id: result.id }))).toBe(false);
    expect(await runtime.completeWorkResultReviewFromTurn(review.reviewerSessionId!, JSON.stringify({ ...envelope, request_id: 'other:report' }))).toBe(false);
    expect(await runtime.completeWorkResultReviewFromTurn(review.reviewerSessionId!, JSON.stringify({ ...envelope, extra: true }))).toBe(false);
    expect(await runtime.completeWorkResultReviewFromTurn(review.reviewerSessionId!, text)).toBe(true);
    const reportId = q.getWorkResultAiReview(review.id)!.reportResultId;
    expect(q.getWorkResult(reportId!)?.result.body).toBe(envelope.body);
    expect(await runtime.completeWorkResultReviewFromTurn(review.reviewerSessionId!, text)).toBe(true);
    expect(q.getWorkResultAiReview(review.id)?.reportResultId).toBe(reportId);
    release?.(); release = undefined;
    await flush();
    expect(q.getWorkResultAiReview(review.id)?.status).toBe('completed');
  });

  it('never resurrects a cancelled reviewer through its otherwise valid host completion', async () => {
    const { result } = seed();
    waitForReview();
    const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'cancelled-codex', resultId: result.id, harness: 'codex' });
    await flush();
    const review = q.getWorkResultAiReview(requested.review.id)!;
    await runtime.cancelWorkResultAiReview(actor, review.id);
    await expect(runtime.completeWorkResultReviewFromTurn(review.reviewerSessionId!, JSON.stringify({
      ri_result_review_report: 'v1', request_id: 'cancelled-codex:report', review_id: review.id, body: 'Too late.',
    }))).rejects.toMatchObject({ code: 'conflict' });
    expect(q.getWorkResultAiReview(review.id)?.status).toBe('cancelled');
    expect(q.getWorkResultAiReview(review.id)?.reportResultId).toBeNull();
  });

  it('preparation completion after disable is restricted to its exact admitted request', async () => {
    const { session, source, result } = seed();
    waitForReview();
    const prep = await runtime.prepareWorkResultHandoff(actor, { requestId: 'update', sourceChatSessionId: session.id, sourceEventId: source.id, resultId: result.id });
    await flush();
    expect(q.getRun(prep.runId!)?.status).toBe('running');
    caps.setWorkResultCapabilities({ handoffsEnabled: false });
    const author: WorkResultActor = { userId: 'local', source: 'ai', sessionId: session.id };
    expect(() => q.createWorkResult(author, { requestId: 'unrelated', body: 'Unrelated report' })).toThrow('disabled');
    expect(() => q.createWorkResult(author, { requestId: 'update', body: 'Changed handoff without exact supersession' })).toThrow();
    const updated = q.createWorkResult(author, { requestId: 'update', body: 'Updated research memo.', supersedesId: result.id });
    expect(updated.result.supersedesId).toBe(result.id);
    expect(q.getWorkResult(result.id)?.result.body).toBe('Durable research findings.');
  });

  it('records interruption after runtime recovery without relaunching a reviewer', async () => {
    const { result } = seed();
    waitForReview();
    const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'review', resultId: result.id });
    await flush();
    const review = q.getWorkResultAiReview(requested.review.id)!;
    q.reapStaleRunningRuns();
    (globalThis as unknown as Record<symbol, Set<string>>)[Symbol.for('ri.process.work-results.dispatches')].clear();
    runtime.recoverWorkResultOperations();
    expect(q.getWorkResultAiReview(review.id)?.statusReason).toBe('interrupted');
    expect(q.getWorkResultAiReview(review.id)?.status).toBe('failed');
    await runtime.dispatchQueuedWorkResultOperations();
    expect(mock.dispatch).toHaveBeenCalledTimes(1);
  });

  it('preserves an accepted worker operation across home recovery and settles its final signal without a waiter', async () => {
    const { session } = seed();
    mock.live.add(session.id);
    const prep = await runtime.prepareWorkResultHandoff(actor, { requestId: 'worker-preparation', sourceChatSessionId: session.id });
    const device = q.createDevice({ name: 'Laptop', kind: 'computer' });
    q.updateChatSession(session.id, { deviceId: device.id });
    q.queueWorkerCommand({ deviceId: device.id, kind: 'send', chatSessionId: session.id, sourceEventId: prep.messageId!,
      payload: { runId: prep.runId, turnId: 'worker-turn' }, actor: { source: 'human' } });
    q.transitionWorkResultOperationRun(prep.runId!, ['queued'], 'running');
    runtime.recoverWorkResultOperations();
    q.reapStaleRunningRuns();
    expect(q.getRun(prep.runId!)?.status).toBe('running');
    expect(mock.dispatch).not.toHaveBeenCalled();
    q.transitionWorkResultOperationRun(prep.runId!, ['running'], 'completed');
    await runtime.settleWorkResultOperationTurn('unrelated-chat', prep.runId!, { ok: true });
    expect(q.getRun(prep.runId!)?.status).toBe('completed');
    await runtime.settleWorkResultOperationTurn(session.id, prep.runId!, { ok: true });
    expect(q.getRun(prep.runId!)?.statusReason).toBe('missing_handoff');
    expect(q.getRun(prep.runId!)?.status).toBe('failed');
  });

  it('uses compatible completed evidence and requires a deliberate rerun to launch again', async () => {
    const { result } = seed();
    mock.hook = async (sessionId) => {
      const review = q.getWorkResultAiReviewForSession(sessionId)!;
      q.reportWorkResultAiReview({ userId: 'local', source: 'ai', sessionId }, { requestId: 'report', reviewId: review.id, body: 'No actionable issues in the memo. Source availability remains uncertain.' },
        { attachments: [], drift: null });
    };
    const first = await runtime.requestWorkResultAiReview(actor, { requestId: 'review', resultId: result.id });
    await flush();
    const reused = await runtime.requestWorkResultAiReview(actor, { requestId: 'review-next', resultId: result.id });
    expect(reused.review.id).toBe(first.review.id);
    expect(reused.reused).toBe(true);
    expect(mock.dispatch).toHaveBeenCalledTimes(1);
    caps.setWorkResultCapabilities({ aiReviewEnabled: false });
    q.updateUserState({ defaultHarness: 'codex', defaultModel: 'gpt-5.5' });
    const replay = await runtime.requestWorkResultAiReview(actor, { requestId: 'review-next', resultId: result.id });
    expect(replay.review.id).toBe(first.review.id);
    expect(replay.idempotentReplay).toBe(true);
    q.updateUserState({ defaultHarness: 'claude', defaultModel: 'opus' });
    caps.setWorkResultCapabilities({ aiReviewEnabled: true });
    const rerun = await runtime.requestWorkResultAiReview(actor, { requestId: 'review-again', resultId: result.id, rerun: true });
    await flush();
    expect(mock.dispatch).toHaveBeenCalledTimes(2);
    expect(q.getWorkResultAiReview(rerun.review.id)?.status).toBe('completed');
  });

  it('does not treat dirty or changed code as compatible fresh review evidence', () => {
    const scope: WorkResultReviewScope = { requested: { resultId: 'result', repository: '/repo', baseSha: 'base', attachments: [], capturedAt: 'then',
      codeRevision: { commitSha: 'sha', workingTreeState: 'clean', capturedAt: 'then' } },
      observed: { codeRevision: { commitSha: 'sha', workingTreeState: 'clean', capturedAt: 'now' }, drift: false } };
    const selection = { harness: 'claude' as const, model: 'opus', variant: null, effort: 'high' as const };
    const review = { status: 'completed', reportResultId: 'report', focus: null, scope, selection,
      provenance: { independence: 'observed' } } as WorkResultAiReviewRecord;
    expect(runtime.compatibleWorkResultReviewEvidence(review, scope, selection)).toBe(true);
    expect(runtime.compatibleWorkResultReviewEvidence(review, { ...scope, observed: { ...scope.observed,
      codeRevision: { commitSha: 'sha', workingTreeState: 'dirty', capturedAt: 'now' } } }, selection)).toBe(false);
    expect(runtime.compatibleWorkResultReviewEvidence(review, { ...scope, observed: { ...scope.observed,
      codeRevision: { commitSha: 'other', workingTreeState: 'clean', capturedAt: 'now' } } }, selection)).toBe(false);
    expect(runtime.compatibleWorkResultReviewEvidence(review, scope, { ...selection, effort: 'low' })).toBe(false);
  });

  it('reuses completed clean-code evidence after refreshing a queued unknown observation at final admission', async () => {
    const repo = path.join(root, 'clean-review');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    fs.writeFileSync(path.join(repo, 'value.txt'), 'the saved work\n');
    execFileSync('git', ['add', 'value.txt'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Saved work'], { cwd: repo });
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const workspace = q.createWorkspace({ name: 'Clean review', cwd: repo, isGit: true });
    const source = q.createChatSession({ harness: 'claude', type: 'content', workspaceId: workspace.id });
    q.insertChatEvent({ sessionId: source.id, role: 'user', source: 'user', content: 'Inspect the saved work.' });
    const result = q.createWorkResult(actor, { requestId: 'clean-work', body: 'The saved clean revision.' }, {
      sourceChatSessionId: source.id,
      codeRevision: { commitSha: sha, workingTreeState: 'clean', capturedAt: new Date().toISOString() },
    }).result;
    mock.hook = async (sessionId) => {
      const review = q.getWorkResultAiReviewForSession(sessionId)!;
      q.reportWorkResultAiReview({ userId: 'local', source: 'ai', sessionId }, {
        requestId: 'clean-evidence-report', reviewId: review.id,
        body: 'Inspected value.txt at the named clean commit. No actionable findings.',
      }, await runtime.observeWorkResultReviewScope(review));
    };
    const first = await runtime.requestWorkResultAiReview(actor, { requestId: 'clean-first', resultId: result.id });
    await vi.waitFor(() => expect(q.getWorkResultAiReview(first.review.id)?.status).toBe('completed'));
    const completed = q.getWorkResultAiReview(first.review.id)!;
    expect(completed.scope.observed?.drift).toBe(false);
    expect(completed.provenance.independence).toBe('observed');
    const scope = { ...completed.scope, observed: { ...completed.scope.observed, drift: null } };
    const waiting = q.createWorkResultAiReview(actor, {
      requestId: 'clean-waiting', resultId: result.id, selection: completed.selection,
      scope, brief: 'Inspect the same saved clean revision.',
      provenance: { method: 'fresh_session', independence: 'unknown' },
    }).review;
    const reviewerId = runtime.bindWorkResultReviewRuntime(actor, waiting, 'clean-waiting', q.getWorkResult(result.id)!);
    const bound = q.getWorkResultAiReview(waiting.id)!;
    expect(runtime.compatibleWorkResultReviewEvidence(completed, bound.scope, bound.selection)).toBe(false);
    expect(await runtime.verifyQueuedWorkResultReviewScope(bound.runId!)).toBe(true);
    const observed = q.getWorkResultAiReview(waiting.id)!;
    expect(observed.scope.requested).toEqual(completed.scope.requested);
    expect(observed.scope.observed).toMatchObject({ drift: false, codeRevision: { commitSha: sha, workingTreeState: 'clean' } });
    expect(runtime.admitWorkResultOperationDispatch(bound.runId!, reviewerId)).toBe(false);
    expect(q.getWorkResultAiReview(waiting.id)).toMatchObject({ status: 'cancelled', statusReason: 'reused_existing_review',
      provenance: { reusedReviewId: completed.id } });
    expect(q.getRun(bound.runId!)?.status).toBe('cancelled');
    expect(mock.dispatch).toHaveBeenCalledTimes(1);
    expect(q.getWorkResultAiReview(completed.id)?.reportResultId).toBe(completed.reportResultId);
  });

  it('never dispatches a saved clean-code review against a changed live checkout', async () => {
    const repo = path.join(root, 'code');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    fs.writeFileSync(path.join(repo, 'value.txt'), 'original\n');
    execFileSync('git', ['add', 'value.txt'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Original'], { cwd: repo });
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const workspace = q.createWorkspace({ name: 'Code review', cwd: repo, isGit: true });
    const session = q.createChatSession({ harness: 'claude', type: 'content', workspaceId: workspace.id });
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'Update the value.' });
    const result = q.createWorkResult(actor, { requestId: 'code', body: 'Updated the value.' }, {
      sourceChatSessionId: session.id,
      codeRevision: { commitSha: sha, workingTreeState: 'clean', capturedAt: new Date().toISOString() },
    }).result;
    const unknown = await runtime.observeWorkResultReviewScope({ scope: { requested: {
      resultId: result.id, repository: repo, codeRevision: null, capturedAt: 'unknown', attachments: [],
    } } });
    expect(unknown?.codeRevision?.commitSha).toBe(sha);
    expect(unknown?.drift).toBeNull();
    mock.beforeAdmission = async () => { fs.writeFileSync(path.join(repo, 'value.txt'), 'later change\n'); };
    const inspected = vi.fn();
    mock.hook = async () => { inspected(); };
    const requested = await runtime.requestWorkResultAiReview(actor, { requestId: 'code-review', resultId: result.id });
    await vi.waitFor(() => expect(q.getWorkResultAiReview(requested.review.id)?.statusReason).toBe('target_changed'));
    expect(q.getWorkResultAiReview(requested.review.id)?.provenance.independence).toBe('unknown');
    expect(inspected).not.toHaveBeenCalled();
    expect(q.getWorkResult(result.id)?.result.codeRevision?.workingTreeState).toBe('clean');
  });
});
