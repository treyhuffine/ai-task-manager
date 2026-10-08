import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkResultActor } from '@/db/types';

const provider = vi.hoisted(() => ({ live: new Set<string>(), background: new Set<string>(), dispatch: vi.fn(), beforeAdmission: null as (() => void) | null }));
vi.mock('@/lib/executor/adapter', () => ({ dispatch: provider.dispatch, isRunning: (id: string) => provider.live.has(id),
  hasBackgroundTasks: (id: string) => provider.background.has(id) }));
vi.mock('@/lib/embeddings/embed', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/embeddings/embed')>(), upsertEmbedding: vi.fn(),
}));
vi.mock('@/lib/harness/model-discovery', () => ({
  getHarnessModelCatalog: async () => [{ id: 'opus', supportedEfforts: ['high'] }],
  resolveHarnessSelection: async (providerId: string, requested: { model?: string; effort?: string }) => {
    if (requested.model === 'unavailable') throw new Error('The saved model is unavailable');
    return { providerId, model: requested.model ?? 'opus', effort: requested.effort ?? 'high', variant: null };
  },
}));
vi.mock('@/lib/harness/runtime', () => ({ getHarnessRuntime: async () => ({ capabilities: {
  sessions: { supported: true }, planMode: { supported: true }, mcp: { supported: true },
  reasoningEffort: { supported: true }, modelVariants: { supported: false },
} }) }));
vi.mock('@/lib/attachments/expand-markers', () => ({ expandMarkers: async (text: string) => text }));
vi.mock('@/lib/entity-refs/expand-markers', () => ({ expandEntityMarkers: (text: string) => text }));

describe('opt-in automatic result review', () => {
  const human: WorkResultActor = { userId: 'local', source: 'human' };
  let root: string;
  let previous: Record<string, string | undefined>;
  let q: typeof import('@/lib/db/queries');
  let automatic: typeof import('./automatic');
  let runtime: typeof import('./runtime');
  let caps: typeof import('./capabilities');

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-results-auto-'));
    previous = Object.fromEntries(['RI_ROOT', 'RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_MIRROR_DISABLED'].map((key) => [key, process.env[key]]));
    process.env.RI_ROOT = root;
    process.env.RI_DB_PATH = path.join(root, 'data.db');
    process.env.RI_CONFIG_DIR = path.join(root, '.config');
    process.env.RI_MIRROR_DISABLED = '1';
    vi.resetModules();
    provider.live.clear();
    provider.background.clear();
    provider.dispatch.mockReset();
    provider.beforeAdmission = null;
    (globalThis as unknown as Record<symbol, Set<string>>)[Symbol.for('ri.process.work-results.dispatches')]?.clear();
    (globalThis as unknown as Record<symbol, Set<string>>)[Symbol.for('ri.process.work-results.session-dispatches')]?.clear();
    q = await import('@/lib/db/queries');
    runtime = await import('./runtime');
    automatic = await import('./automatic');
    caps = await import('./capabilities');
    caps.setWorkResultCapabilities({ handoffsEnabled: true, aiReviewEnabled: true });
    provider.dispatch.mockImplementation(async (sessionId: string, _prompt: string, options: { resultOperationRunId: string }) => {
      provider.beforeAdmission?.();
      if (!runtime.admitWorkResultOperationDispatch(options.resultOperationRunId, sessionId, (id) => provider.live.has(id))) throw new Error('Admission denied');
      const run = q.getRun(options.resultOperationRunId)!;
      const op = q.workResultOperationMetadata(run.triggerPayload)!;
      q.reportWorkResultAiReview({ userId: 'local', source: 'ai', sessionId }, {
        requestId: `${op.requestId}:report`, reviewId: op.reviewId!, body: 'Inspected the retained memo. No actionable issues. No external sources checked.',
      });
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    (await import('@/lib/db')).resetDb();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  function seed(enabled: boolean | null = true) {
    const workspace = q.createWorkspace({ name: 'Author', cwd: root, isGit: false,
      reviewBeforeHandoff: enabled, reviewDefaults: { harness: 'claude', model: 'opus', effort: 'high' } });
    const session = q.createChatSession({ harness: 'claude', type: 'orchestration', workspaceId: workspace.id });
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'Write an offline memo.' });
    return { workspace, session };
  }

  async function save(sessionId: string, requestId = 'memo') {
    const actor: WorkResultActor = { userId: 'local', source: 'ai', sessionId };
    const automaticReview = await automatic.prepareAutomaticWorkResultReview(actor, sessionId);
    return q.createWorkResult(actor, { requestId, body: 'A useful offline memo.' }, { automaticReview });
  }

  it('keeps null/off preferences and either disabled gate free of automatic requests', async () => {
    for (const preference of [null, false]) {
      const { session } = seed(preference);
      await save(session.id);
    }
    const { session } = seed(true);
    caps.setWorkResultCapabilities({ aiReviewEnabled: false });
    await save(session.id);
    expect(q.listActiveWorkResultAiReviews()).toHaveLength(0);
    caps.setWorkResultCapabilities({ handoffsEnabled: false, aiReviewEnabled: true });
    expect(await automatic.prepareAutomaticWorkResultReview(human, session.id)).toBeUndefined();
    expect(provider.dispatch).not.toHaveBeenCalled();
  });

  it('atomically records one exact request per multi-task result, waits for author quiescence and never reviews its report', async () => {
    const { session } = seed();
    const actor: WorkResultActor = { userId: 'local', source: 'ai', sessionId: session.id };
    const taskIds = [q.createTask({ title: 'First criterion' }).id, q.createTask({ title: 'Second criterion' }).id];
    const automaticReview = await automatic.prepareAutomaticWorkResultReview(actor, session.id);
    const input = { requestId: 'multi-task', body: 'One deliverable concerns both tasks.', taskIds };
    const saved = q.createWorkResult(actor, input, { automaticReview });
    expect(q.getWorkResult(saved.result.id)!.taskIds.sort()).toEqual(taskIds.sort());
    expect(q.getWorkResult(saved.result.id)!.aiReviews).toHaveLength(1);
    expect(q.listChatEvents(session.id).filter((event) => event.source === 'work_result')).toHaveLength(1);
    expect(q.createWorkResult(actor, input, { automaticReview }).idempotentReplay).toBe(true);
    provider.live.add(session.id);
    await automatic.dispatchAutomaticWorkResultReviews(session.id);
    expect(provider.dispatch).not.toHaveBeenCalled();
    expect(q.getWorkResult(saved.result.id)!.aiReviews[0].reviewerSessionId).toBeNull();
    provider.live.delete(session.id);
    await Promise.all([automatic.dispatchAutomaticWorkResultReviews(session.id), automatic.dispatchAutomaticWorkResultReviews(session.id)]);
    await vi.waitFor(() => expect(q.getWorkResult(saved.result.id)!.aiReviews[0].status).toBe('completed'));
    expect(provider.dispatch).toHaveBeenCalledTimes(1);
    const review = q.getWorkResult(saved.result.id)!.aiReviews[0];
    expect(review.brief).toContain('Write an offline memo.');
    expect(review.brief).toContain('First criterion');
    expect(review.provenance.automaticWorkspaceId).toBeTruthy();
    expect(q.getWorkResult(review.reportResultId!)!.aiReviews).toHaveLength(0);
    expect(q.getTask(taskIds[0])!.status).toBe('todo');
    expect(q.listWorkResults()).toHaveLength(1);
  });

  it('cannot treat implementer-reported independence as satisfying the preference', async () => {
    const { session } = seed();
    const actor: WorkResultActor = { userId: 'local', source: 'ai', sessionId: session.id };
    const saved = q.createWorkResult(actor, { requestId: 'reported', body: 'A memo.', independentReview: {
      body: 'An alleged independent check.', provenance: { method: 'native_review', independence: 'observed' },
    } }, { automaticReview: await automatic.prepareAutomaticWorkResultReview(actor, session.id) });
    const reviews = q.getWorkResult(saved.result.id)!.aiReviews;
    expect(reviews).toHaveLength(2);
    expect(reviews.find((review) => review.reportResultId)!.provenance.independence).toBe('reported');
    expect(reviews.find((review) => review.status === 'queued')!.provenance.automaticRequestId).toBeTruthy();
  });

  it('saves an unavailable default as a visible failed review without blocking or falsely reviewing the handoff', async () => {
    const { workspace, session } = seed();
    q.updateWorkspace(workspace.id, { reviewDefaults: { harness: 'claude', model: 'unavailable' } });
    const saved = await save(session.id);
    const review = q.getWorkResult(saved.result.id)!.aiReviews[0];
    expect(review.status).toBe('failed');
    expect(review.statusReason).toBe('reviewer_unavailable');
    expect(review.selection.model).toBe('unavailable');
    expect(review.provenance.limitations?.join()).toContain('unavailable');
    expect(q.getWorkResult(saved.result.id)!.result.body).toBe('A useful offline memo.');
    expect(provider.dispatch).not.toHaveBeenCalled();
  });

  it('cancels a waiting request at disable and does not resume it after reenabling or replay', async () => {
    const { session } = seed();
    const saved = await save(session.id);
    caps.setWorkResultCapabilities({ aiReviewEnabled: false });
    runtime.reconcileWorkResultCapabilities();
    expect(q.getWorkResult(saved.result.id)!.aiReviews[0].status).toBe('cancelled');
    caps.setWorkResultCapabilities({ aiReviewEnabled: true });
    expect((await save(session.id)).idempotentReplay).toBe(true);
    await automatic.dispatchAutomaticWorkResultReviews(session.id);
    expect(provider.dispatch).not.toHaveBeenCalled();
    expect(q.getWorkResult(saved.result.id)!.aiReviews).toHaveLength(1);
  });

  it('records an interrupted request after restart and never silently launches it', async () => {
    const { session } = seed();
    const saved = await save(session.id);
    runtime.recoverWorkResultOperations();
    const review = q.getWorkResult(saved.result.id)!.aiReviews[0];
    expect(review.status).toBe('failed');
    expect(review.statusReason).toBe('interrupted');
    await automatic.dispatchAutomaticWorkResultReviews(session.id);
    expect(provider.dispatch).not.toHaveBeenCalled();
  });

  it('honors authoring Stop and preference changes while waiting without scheduling a replacement', async () => {
    const first = seed();
    const saved = await save(first.session.id);
    automatic.cancelQueuedAutomaticReviewsForAuthor(first.session.id);
    expect(q.getWorkResult(saved.result.id)!.aiReviews[0].statusReason).toBe('authoring_stopped');
    const second = seed();
    const other = await save(second.session.id);
    q.updateWorkspace(second.workspace.id, { reviewBeforeHandoff: false });
    await automatic.dispatchAutomaticWorkResultReviews(second.session.id);
    expect(q.getWorkResult(other.result.id)!.aiReviews[0].statusReason).toBe('preference_disabled');
    expect(provider.dispatch).not.toHaveBeenCalled();
  });

  it('rechecks the saved preference at final admission after runtime discovery yields', async () => {
    const { workspace, session } = seed();
    const saved = await save(session.id);
    provider.beforeAdmission = () => q.updateWorkspace(workspace.id, { reviewBeforeHandoff: false });
    await automatic.dispatchAutomaticWorkResultReviews(session.id);
    await vi.waitFor(() => expect(q.getWorkResult(saved.result.id)!.aiReviews[0].status).toBe('cancelled'));
    const review = q.getWorkResult(saved.result.id)!.aiReviews[0];
    expect(review.statusReason).toBe('preference_disabled');
    expect(q.getRun(review.runId!)!.startedAt).toBeNull();
    expect(review.reportResultId).toBeNull();
  });

  it('keeps a discovered automatic request queued if its author resumes before admission', async () => {
    const { session } = seed();
    const saved = await save(session.id);
    provider.beforeAdmission = () => provider.live.add(session.id);
    await automatic.dispatchAutomaticWorkResultReviews(session.id);
    await vi.waitFor(() => expect(q.getRun(q.getWorkResult(saved.result.id)!.aiReviews[0].runId!)!.statusReason).toBe('waiting_for_author'));
    expect(q.getWorkResult(saved.result.id)!.aiReviews[0].status).toBe('queued');
    provider.beforeAdmission = null;
    provider.live.delete(session.id);
    await automatic.dispatchAutomaticWorkResultReviews(session.id);
    await vi.waitFor(() => expect(q.getWorkResult(saved.result.id)!.aiReviews[0].status).toBe('completed'));
    expect(q.getWorkResult(saved.result.id)!.aiReviews).toHaveLength(1);
  });

  it('retains a usable handoff when an additional original-request file is unavailable', async () => {
    const { session } = seed();
    const file = { fileName: 'missing-original.txt', originalName: 'original.txt', mimeType: 'text/plain', size: 4, uploadedAt: new Date().toISOString() };
    const task = q.createTask({ title: 'Original criteria', body: `Read [original](/api/attachments/${file.fileName}).`, attachments: [file] });
    const actor: WorkResultActor = { userId: 'local', source: 'ai', sessionId: session.id };
    const saved = q.createWorkResult(actor, { requestId: 'retained', body: 'Usable output.', taskIds: [task.id] },
      { automaticReview: await automatic.prepareAutomaticWorkResultReview(actor, session.id) });
    const detail = q.getWorkResult(saved.result.id)!;
    expect(detail.result.body).toBe('Usable output.');
    expect(detail.aiReviews[0].statusReason).toBe('review_inputs_unavailable');
    expect(detail.aiReviews[0].brief).toContain('Unavailable review input');
    expect(provider.dispatch).not.toHaveBeenCalled();
  });

  it('waits for background authors after the root turn ends', async () => {
    const { session } = seed();
    const saved = await save(session.id);
    provider.background.add(session.id);
    await automatic.dispatchAutomaticWorkResultReviews(session.id);
    expect(provider.dispatch).not.toHaveBeenCalled();
    expect(q.getWorkResult(saved.result.id)!.aiReviews[0].reviewerSessionId).toBeNull();
    provider.background.delete(session.id);
    await automatic.dispatchAutomaticWorkResultReviews(session.id);
    await vi.waitFor(() => expect(q.getWorkResult(saved.result.id)!.aiReviews[0].status).toBe('completed'));
  });

  it('defaults task content-chat results to their exact task without turning note results into task work', async () => {
    const task = q.createTask({ title: 'Producing task' });
    const session = q.createChatSession({ harness: 'claude', type: 'content', surfaceKind: 'task', surfaceRef: task.id });
    const result = q.createWorkResult({ userId: 'local', source: 'ai', sessionId: session.id }, { requestId: 'content', body: 'Task work.' }).result;
    expect(q.getWorkResult(result.id)!.taskIds).toEqual([task.id]);
    const taskless = q.createWorkResult({ userId: 'local', source: 'ai', sessionId: session.id }, { requestId: 'explicit-taskless', body: 'Independent work.', taskIds: [] }).result;
    expect(q.getWorkResult(taskless.id)!.taskIds).toEqual([]);
  });
});
