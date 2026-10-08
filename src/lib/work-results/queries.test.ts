import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { getDb, getRawDb, resetDb } from '@/lib/db';
import { chatEvents, chatSessions, executionTasks, workResultAiReviews, workResultDecisions, workResultTasks, workResults } from '@/lib/db/schema';
import { createChatSession, createExecution, createRun, createTask, createWorkspace, attachExecutionToTask,
  createPreviewTarget, listChatEventsToResume, getExecutionReviewContext, getTaskAttentionSignals } from '@/lib/db/queries';
import { saveAttachment } from '@/lib/attachments/save';
import { dehydrateAttachments } from '@/lib/db/hydrate';
import { collectReferencedFileNames, sweepAttachments } from '@/lib/export/mirror/attachments-gc';
import { setWorkResultCapabilities } from './capabilities';
import {
  createWorkResult, createWorkResultDecision, createWorkResultAiReview, getWorkResult, getWorkResultAiReview,
  linkWorkResultAiReviewRuntime, listWorkResults, reportWorkResultAiReview, workResultRequestScopedId,
  transitionWorkResultAiReview, validateWorkResultAttachments,
} from './queries';
import type { WorkResultActor, WorkResultReviewScope, WorkResultReviewSelection } from '@/db/types';
import { ensureWorkResultOperationMessage } from '@/lib/db/work-result-runtime-queries';
import { runMigrations } from '@/lib/db/migrate';
import { subscribe, sessionChannel } from '@/lib/realtime/bus';

// This suite exercises SQLite writes and retention. External asynchronous
// embeddings are unrelated and must not outlive the temporary connection.
vi.mock('@/lib/embeddings/embed', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/embeddings/embed')>(),
  upsertEmbedding: vi.fn(async () => {}),
  deleteEmbedding: vi.fn(),
}));

let root: string;
const human: WorkResultActor = { userId: 'local', source: 'human' };
const selection: WorkResultReviewSelection = { harness: 'codex', model: 'gpt-6.1', variant: null, effort: 'medium' };

beforeEach(() => {
  resetDb();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-result-storage-'));
  vi.stubEnv('RI_ROOT', root);
  vi.stubEnv('RI_DB_PATH', path.join(root, 'data.db'));
  vi.stubEnv('RI_CONFIG_DIR', path.join(root, 'config'));
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  vi.stubEnv('RI_ATTACHMENT_GC', '1');
  getDb();
  setWorkResultCapabilities({ handoffsEnabled: true, aiReviewEnabled: true });
});

afterEach(() => {
  resetDb();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

function agent() {
  const workspace = createWorkspace({ name: 'Pilot', cwd: root, isGit: false });
  const execution = createExecution({ workspaceId: workspace.id });
  const session = createChatSession({ harness: 'codex', type: 'execution', workspaceId: workspace.id, executionId: execution.id });
  const actor: WorkResultActor = { userId: 'local', source: 'ai', sessionId: session.id, executionId: execution.id };
  return { workspace, execution, session, actor };
}

function scope(resultId: string): WorkResultReviewScope {
  return { requested: { resultId, capturedAt: '2026-10-07T00:00:00Z', attachments: [] } };
}

function requestedReview(actor: WorkResultActor = human) {
  const result = createWorkResult(human, { requestId: 'target', body: 'Useful work' }).result;
  const review = createWorkResultAiReview(actor, {
    requestId: 'review', resultId: result.id, brief: 'Original task and exact artifacts',
    selection, scope: scope(result.id), provenance: { method: 'fresh_session', independence: 'observed' },
  }).review;
  const session = createChatSession({ harness: 'codex', type: 'orchestration', surfaceKind: 'result_review', surfaceRef: review.id });
  const run = createRun({ harness: 'codex', triggerKind: 'manual', chatSessionId: session.id });
  linkWorkResultAiReviewRuntime(review.id, { reviewerSessionId: session.id, runId: run.id });
  transitionWorkResultAiReview(review.id, 'queued', 'running');
  return { result, review, session, run, reviewer: { userId: 'local', source: 'ai', sessionId: session.id } as WorkResultActor };
}

describe('durable result identity and immutable snapshots', () => {
  it('deduplicates concurrent retries into one result, event, gallery and task membership', async () => {
    const { actor, execution, session } = agent();
    const task = createTask({ title: 'Produce work' });
    attachExecutionToTask(execution.id, task.id);
    const file = await saveAttachment({ data: Buffer.from('durable evidence'), originalName: 'evidence.txt', mimeType: 'text/plain' });
    const input = { requestId: 'shared-key', body: 'Finished the work', attachments: [file] };
    const retries = await Promise.all(Array.from({ length: 8 }, () => Promise.resolve().then(() => createWorkResult(actor, input))));
    expect(new Set(retries.map((r) => r.result.id)).size).toBe(1);
    expect(retries.filter((r) => !r.idempotentReplay)).toHaveLength(1);
    const detail = getWorkResult(retries[0].result.id)!;
    expect(detail.result.attachments).toEqual([file]);
    expect(detail.taskIds).toEqual([task.id]);
    expect(getDb().select().from(chatEvents).where(eq(chatEvents.sessionId, session.id)).all().filter((e) => e.source === 'work_result')).toHaveLength(1);
    expect(getDb().select().from(workResultTasks).all()).toHaveLength(1);
    expect(getRawDb().prepare('SELECT attachments FROM work_results').get()).toEqual({ attachments: JSON.stringify(dehydrateAttachments([file])) });
  });

  it('publishes one committed contextual ISO event and never broadcasts a rolled-back result', () => {
    const { actor, session } = agent();
    const messages: unknown[] = [];
    const unsubscribe = subscribe(sessionChannel(session.id), (message) => messages.push(message));
    try {
      const input = { requestId: 'stream', body: 'A live saved answer' };
      createWorkResult(actor, input);
      createWorkResult(actor, input);
      expect(() => createWorkResult(actor, { requestId: 'invalid-nested', body: 'Invalid', independentReview: { body: '' } })).toThrow();
      expect(messages).toHaveLength(1);
      const event = getDb().select().from(chatEvents).where(eq(chatEvents.sessionId, session.id)).get()!;
      expect(event.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(event.source).toBe('work_result');
    } finally { unsubscribe(); }
  });

  it('rejects changed body, explicit task intent and changed nested evidence with a reused key', () => {
    createWorkResult(human, { requestId: 'key', body: 'Snapshot' });
    expect(() => createWorkResult(human, { requestId: 'key', body: 'Changed' })).toThrow(/different intent/);
    expect(() => createWorkResult(human, { requestId: 'key', body: 'Snapshot', taskIds: [] })).toThrow(/different intent/);
    const nested = { requestId: 'nested', body: 'Snapshot', independentReview: { body: 'No actionable findings' } };
    const saved = createWorkResult(human, nested);
    expect(createWorkResult(human, nested).result.id).toBe(saved.result.id);
    expect(() => createWorkResult(human, { ...nested, independentReview: { body: 'One issue' } })).toThrow(/different intent/);
  });

  it('scopes retry identities to authority and stable human or signed agent identity', () => {
    const first = agent();
    const second = agent();
    expect(workResultRequestScopedId('report_result', first.actor, 'same')).not.toBe(workResultRequestScopedId('report_result', second.actor, 'same'));
    expect(workResultRequestScopedId('report_result', human, 'same')).not.toBe(workResultRequestScopedId('report_result', first.actor, 'same'));
    expect(() => createWorkResult({ userId: 'local', source: 'ai' }, { requestId: 'x', body: 'Claim' })).toThrow(/authenticated session/);
    expect(() => createWorkResult({ userId: 'elsewhere', source: 'human' }, { requestId: 'x', body: 'Claim' })).toThrow(/authority/);
  });

  it('keeps task membership exact and distinguishes omitted, empty and multi-task defaults', () => {
    const { execution, actor } = agent();
    const first = createTask({ title: 'First' });
    const second = createTask({ title: 'Second' });
    attachExecutionToTask(execution.id, first.id);
    const initial = createWorkResult(actor, { requestId: 'single', body: 'One task result' }).result;
    const taskless = createWorkResult(actor, { requestId: 'empty', body: 'Explicitly taskless', taskIds: [] }).result;
    attachExecutionToTask(execution.id, second.id);
    const ambiguous = createWorkResult(actor, { requestId: 'many', body: 'No guessed completion' }).result;
    const explicit = createWorkResult(actor, { requestId: 'both', body: 'Two task result', taskIds: [second.id, first.id] }).result;
    getDb().delete(executionTasks).where(eq(executionTasks.executionId, execution.id)).run();
    expect(getWorkResult(initial.id)!.taskIds).toEqual([first.id]);
    expect(getWorkResult(taskless.id)!.taskIds).toEqual([]);
    expect(getWorkResult(ambiguous.id)!.taskIds).toEqual([]);
    expect(getWorkResult(explicit.id)!.taskIds.sort()).toEqual([first.id, second.id].sort());
    expect(createWorkResult(actor, { requestId: 'single', body: 'One task result' }).idempotentReplay).toBe(true);
  });

  it('preserves predecessor disposition and allows one meaningful exact successor', () => {
    const task = createTask({ title: 'Remain ordinary todo' });
    const old = createWorkResult(human, { requestId: 'old', body: 'Version one', taskIds: [task.id] }).result;
    createWorkResultDecision(human, { requestId: 'accept', resultId: old.id, disposition: 'accepted' });
    const next = createWorkResult(human, { requestId: 'next', body: 'Version two', supersedesId: old.id }).result;
    expect(getWorkResult(next.id)!.taskIds).toEqual([task.id]);
    expect(getWorkResult(next.id)!.reviews).toEqual([]);
    expect(getWorkResult(old.id)!.reviews[0].disposition).toBe('accepted');
    expect(getWorkResult(old.id)!.successorId).toBe(next.id);
    expect(() => createWorkResult(human, { requestId: 'racer', body: 'Other replacement', supersedesId: old.id })).toThrow(/successor/);
    expect(listWorkResults().map((r) => r.id)).toEqual([next.id]);
    expect(listWorkResults({ includeSuperseded: true })).toHaveLength(2);
    expect(getRawDb().prepare('SELECT status FROM tasks WHERE id = ?').get(task.id)).toEqual({ status: 'todo' });
  });

  it('rejects unchanged replacements, missing tasks, cross-owner sources, and origin impersonation', () => {
    const old = createWorkResult(human, { requestId: 'old', body: 'Existing usable work' }).result;
    expect(() => createWorkResult(human, { requestId: 'no-change', body: old.body, supersedesId: old.id })).toThrow(/already contains/);
    expect(() => createWorkResult(human, { requestId: 'missing', body: 'Work', taskIds: ['missing'] })).toThrow(/linked task/);
    const first = agent();
    const second = agent();
    expect(() => createWorkResult(first.actor, { requestId: 'wrong-source', body: 'Claim' }, { sourceChatSessionId: second.session.id })).toThrow(/another session/);
    getDb().update(chatSessions).set({ userId: 'someone-else' }).where(eq(chatSessions.id, second.session.id)).run();
    expect(() => createWorkResult(human, { requestId: 'private', body: 'Claim' }, { sourceChatSessionId: second.session.id })).toThrow(/source conversation/);
    expect(getWorkResult(old.id, 'someone-else')).toBeUndefined();
    expect(listWorkResults({}, 'someone-else')).toEqual([]);
  });

  it('atomically rolls back the handoff and transcript when nested evidence is invalid', () => {
    const { actor, session } = agent();
    expect(() => createWorkResult(actor, { requestId: 'bad-nested', body: 'Ready', independentReview: { body: '' } })).toThrow(/nonempty report/);
    expect(listWorkResults()).toEqual([]);
    expect(getDb().select().from(chatEvents).where(eq(chatEvents.sessionId, session.id)).all()).toEqual([]);
  });

  it('preserves the selected human save answer and omitted gallery, with source-independent replay', async () => {
    const { session } = agent();
    const file = await saveAttachment({ data: Buffer.from('gallery-only output'), originalName: 'gallery.txt', mimeType: 'text/plain' });
    const sourceId = 'selected-agent-output';
    const originalBody = '    indented Markdown code\n\nA useful selected answer.\n\n';
    getDb().insert(chatEvents).values({ id: sourceId, sessionId: session.id, role: 'assistant', source: 'agent', content: originalBody, attachments: dehydrateAttachments([file]) }).run();
    const input = { requestId: 'save-selected', body: originalBody };
    const origin = { sourceChatSessionId: session.id, sourceEventId: sourceId };
    const saved = createWorkResult(human, input, origin).result;
    expect(saved.body).toBe(input.body);
    expect(saved.attachments).toEqual([file]);
    expect(saved.actorSource).toBe('human');
    expect(saved.sourceEventId).toBe(sourceId);
    expect(() => createWorkResult(human, { ...input, requestId: 'trimmed-answer', body: originalBody.trim() }, origin)).toThrow(/exact selected agent answer/);
    expect(() => createWorkResult(human, { ...input, requestId: 'changed-answer', body: 'User wrote different content' }, origin)).toThrow(/exact selected agent answer/);
    expect(() => createWorkResult(human, { ...input, requestId: 'drop-gallery', attachments: [] }, origin)).toThrow(/exact selected answer attachments/);
    const unrelated = await saveAttachment({ data: Buffer.from('unrelated upload'), originalName: 'unrelated.txt', mimeType: 'text/plain' });
    expect(() => createWorkResult(human, { ...input, requestId: 'add-gallery', attachments: [file, unrelated] }, origin)).toThrow(/exact selected answer attachments/);
    const explicitInput = { ...input, requestId: 'explicit-gallery', attachments: [file, file] };
    expect(createWorkResult(human, explicitInput, origin).result.attachments).toEqual([file]);
    const inlineBody = `Download [[file:${file.fileName}]]`;
    getDb().insert(chatEvents).values({ id: 'inline-source', sessionId: session.id, role: 'assistant', source: 'agent', content: inlineBody, attachments: dehydrateAttachments([file]) }).run();
    expect(createWorkResult(human, { requestId: 'inline-save', body: inlineBody }, { ...origin, sourceEventId: 'inline-source' }).result.attachments).toEqual([file]);
    getDb().insert(chatEvents).values({ id: 'user-source', sessionId: session.id, role: 'user', source: 'user', content: input.body }).run();
    expect(() => createWorkResult(human, { ...input, requestId: 'user-copy' }, { ...origin, sourceEventId: 'user-source' })).toThrow(/exact selected agent answer/);
    getDb().delete(chatSessions).where(eq(chatSessions.id, session.id)).run();
    setWorkResultCapabilities({ handoffsEnabled: false });
    expect(createWorkResult(human, input, origin).idempotentReplay).toBe(true);
    expect(createWorkResult(human, explicitInput, origin).idempotentReplay).toBe(true);
    expect(getWorkResult(saved.id)!.result.attachments).toEqual([file]);
  });

  it('finds an exact saved source through supersession and later list pages over HTTP', async () => {
    const { actor, session } = agent();
    const sourceId = 'historical-selected-output';
    const body = 'Originally saved useful output';
    getDb().insert(chatEvents).values({ id: sourceId, sessionId: session.id, role: 'assistant', source: 'agent', content: body }).run();
    const saved = createWorkResult(human, { requestId: 'selected', body }, { sourceChatSessionId: session.id, sourceEventId: sourceId }).result;
    createWorkResult(actor, { requestId: 'successor', body: 'A meaningful newer snapshot', supersedesId: saved.id });
    for (let index = 0; index < 101; index++) createWorkResult(actor, { requestId: `later-${index}`, body: `Unrelated later deliverable ${index}` });
    expect(listWorkResults({ sourceChatSessionId: session.id, limit: 100 })).not.toContainEqual(saved);
    const filter = { sourceChatSessionId: session.id, sourceEventId: sourceId, includeSuperseded: true, limit: 1 };
    expect(listWorkResults(filter)).toEqual([saved]);
    expect(listWorkResults({ ...filter, sourceChatSessionId: 'another-conversation' })).toEqual([]);
    expect(listWorkResults({ ...filter, sourceEventId: 'another-output' })).toEqual([]);
    expect(listWorkResults(filter, 'another-owner')).toEqual([]);
    const { GET } = await import('@/app/api/results/route');
    const query = new URLSearchParams({ sourceChatSessionId: session.id, sourceEventId: sourceId, includeSuperseded: 'true', limit: '1' });
    const response = await GET(new Request(`http://localhost/api/results?${query}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([saved]);
  });

  it('filters current and historical taskless work after source deletion with capabilities off', async () => {
    const session = createChatSession({ harness: 'codex', type: 'orchestration' });
    const actor: WorkResultActor = { userId: 'local', source: 'ai', sessionId: session.id };
    const original = createWorkResult(actor, { requestId: 'original-research', title: 'Offline budget research', body: 'Earlier conclusion about CSV quoting.' }).result;
    const successor = createWorkResult(actor, { requestId: 'updated-research', title: 'Budget log recommendation', body: 'Current conclusion about an SQLite journal.', supersedesId: original.id }).result;
    getDb().delete(chatSessions).where(eq(chatSessions.id, session.id)).run();
    setWorkResultCapabilities({ handoffsEnabled: false, aiReviewEnabled: false });
    expect(listWorkResults({ query: 'SQLITE' }).map((row) => row.id)).toEqual([successor.id]);
    expect(listWorkResults({ query: 'offline budget' })).toEqual([]);
    expect(listWorkResults({ query: 'CSV quoting', includeSuperseded: true }).map((row) => row.id)).toEqual([original.id]);
    expect(getWorkResult(successor.id)!.result.sourceChatSessionId).toBeNull();
    expect(getWorkResult(successor.id)!.taskIds).toEqual([]);
    expect(getWorkResult(successor.id)!.result.sourceExecutionId).toBeNull();
    const { GET } = await import('@/app/api/results/route');
    const response = await GET(new Request('http://localhost/api/results?query=budget&includeSuperseded=true&limit=1'));
    expect(response.status).toBe(200);
    expect((await response.json()).map((row: { id: string }) => row.id)).toEqual([successor.id]);
  });
});

describe('retention and evidence authority', () => {
  it('keeps gallery files readable through source pruning, restart, capability disable and GC', async () => {
    const { actor, session } = agent();
    const file = await saveAttachment({ data: Buffer.from('saved gallery'), originalName: 'gallery.txt', mimeType: 'text/plain' });
    const input = { requestId: 'gallery', body: 'Gallery output has no inline marker', attachments: [file] };
    const saved = createWorkResult(actor, input).result;
    getDb().delete(chatSessions).where(eq(chatSessions.id, session.id)).run();
    setWorkResultCapabilities({ handoffsEnabled: false, aiReviewEnabled: false });
    resetDb();
    expect(getWorkResult(saved.id)!.result.sourceChatSessionId).toBeNull();
    expect(getWorkResult(saved.id)!.result.attachments).toEqual([file]);
    expect(createWorkResult(actor, input).idempotentReplay).toBe(true);
    expect(collectReferencedFileNames().has(file.fileName)).toBe(true);
    expect((await sweepAttachments()).archived).toBe(0);
    expect(fs.readFileSync(path.join(root, 'attachments', file.fileName), 'utf8')).toBe('saved gallery');
  });

  it('retains review input files independently of result body and both runtime transcripts', async () => {
    const target = createWorkResult(human, { requestId: 'target', body: 'Artifact inspection' }).result;
    const file = await saveAttachment({ data: Buffer.from('source material'), originalName: 'source.txt', mimeType: 'text/plain' });
    const review = createWorkResultAiReview(human, { requestId: 'review', resultId: target.id, brief: 'Read the retained source material', selection,
      scope: { requested: { resultId: target.id, attachments: dehydrateAttachments([file])!, capturedAt: '2026-10-07T00:00:00Z' } }, provenance: { method: 'fresh_session', independence: 'observed' } }).review;
    transitionWorkResultAiReview(review.id, 'queued', 'cancelled', { statusReason: 'disabled' });
    setWorkResultCapabilities({ handoffsEnabled: false, aiReviewEnabled: false });
    expect(collectReferencedFileNames().has(file.fileName)).toBe(true);
    expect((await sweepAttachments()).archived).toBe(0);
  });

  it('retains source-independent feedback files without a dispatch destination or run', async () => {
    const { actor, session } = agent();
    const result = createWorkResult(actor, { requestId: 'source-output', body: 'Durable work' }).result;
    getDb().delete(chatSessions).where(eq(chatSessions.id, session.id)).run();
    const file = await saveAttachment({ data: Buffer.from('feedback screenshot context'), originalName: 'feedback.txt', mimeType: 'text/plain' });
    const input = { requestId: 'feedback-with-file', resultId: result.id, disposition: 'changes_requested' as const,
      note: 'Please address this finding', attachments: [file], context: { attachmentFileName: file.fileName } };
    const saved = createWorkResultDecision(human, input).review;
    expect(saved.attachments).toEqual([file]);
    expect(saved.feedbackSessionId).toBeNull();
    expect(saved.feedbackMessageId).toBeNull();
    expect(saved.context).toEqual(input.context);
    setWorkResultCapabilities({ handoffsEnabled: false, aiReviewEnabled: false });
    resetDb();
    expect(createWorkResultDecision(human, input).idempotentReplay).toBe(true);
    expect(getWorkResult(result.id)!.reviews[0].attachments).toEqual([file]);
    expect(getWorkResult(result.id)!.reviews[0].context).toEqual(input.context);
    expect(collectReferencedFileNames().has(file.fileName)).toBe(true);
    expect((await sweepAttachments()).archived).toBe(0);
    expect(fs.readFileSync(path.join(root, 'attachments', file.fileName), 'utf8')).toBe('feedback screenshot context');
  });

  it('retains exact same-target findings, original file and preview context without its producing conversation', async () => {
    const { actor, session, execution } = agent();
    const file = await saveAttachment({ data: Buffer.from('selected original file'), originalName: 'selected.txt', mimeType: 'text/plain' });
    const preview = createPreviewTarget({ executionId: execution.id, previewName: 'selected-preview' });
    const result = createWorkResult(actor, { requestId: 'target-context', body: 'Work with inspectable outputs', attachments: [file],
      links: [{ kind: 'preview', label: 'Inspect work', previewTargetId: preview.id }] }).result;
    const review = reportWorkResultAiReview(human, { requestId: 'findings', resultId: result.id, body: 'One actionable finding' }).review;
    const other = createWorkResult(human, { requestId: 'other-target', body: 'Other work' }).result;
    const foreignReview = reportWorkResultAiReview(human, { requestId: 'foreign-findings', resultId: other.id, body: 'Unrelated finding' }).review;
    getDb().delete(chatSessions).where(eq(chatSessions.id, session.id)).run();
    const context = { reviewId: review.id, attachmentFileName: file.fileName, previewTargetId: preview.id };
    const input = { requestId: 'contextual-feedback', resultId: result.id, disposition: 'changes_requested' as const,
      note: 'Address the selected finding', context };
    expect(createWorkResultDecision(human, input).review.context).toEqual(context);
    expect(() => createWorkResultDecision(human, { ...input, requestId: 'wrong-review', context: { reviewId: foreignReview.id } })).toThrow(/another result/);
    expect(() => createWorkResultDecision(human, { ...input, requestId: 'wrong-file', context: { attachmentFileName: 'unrelated.txt' } })).toThrow(/not attached/);
    expect(() => createWorkResultDecision(human, { ...input, requestId: 'wrong-preview', context: { previewTargetId: 'unrelated-preview' } })).toThrow(/not part of/);
    expect(() => createWorkResultDecision(human, { ...input, requestId: 'empty-review', context: { reviewId: '' } })).toThrow(/exact retained inspection/);
    setWorkResultCapabilities({ handoffsEnabled: false, aiReviewEnabled: false });
    resetDb();
    expect(getWorkResult(result.id)!.reviews[0].context).toEqual(context);
    expect(createWorkResultDecision(human, input).idempotentReplay).toBe(true);
    expect(() => createWorkResultDecision(human, { ...input, context: {} })).toThrow(/different intent/);
  });

  it('rejects paths, symlinks, mismatched sizes, missing inline files and dangerous links', async () => {
    const file = await saveAttachment({ data: Buffer.from('x'), originalName: 'source.txt', mimeType: 'text/plain' });
    expect(() => validateWorkResultAttachments('', [{ ...file, fileName: '../escape.txt' }], 'local')).toThrow(/metadata/);
    expect(() => validateWorkResultAttachments('', [{ ...file, size: 999 }], 'local')).toThrow(/regular uploaded file/);
    expect(() => createWorkResult(human, { requestId: 'missing-marker', body: '[[file:missing.txt]]' })).toThrow(/lacks an uploaded record/);
    expect(() => createWorkResult(human, { requestId: 'danger', body: 'Work', links: [{ kind: 'url', label: 'Run', url: 'javascript:alert(1)' }] })).toThrow(/HTTP/);
    const symbolic = path.join(root, 'attachments', 'symbolic.txt');
    fs.symlinkSync(path.join(root, 'attachments', file.fileName), symbolic);
    expect(() => validateWorkResultAttachments('', [{ ...file, fileName: 'symbolic.txt' }], 'local')).toThrow(/regular uploaded file/);
  });

  it('stores native author evidence atomically, labels it reported and hides reports from primary lists', () => {
    const { actor } = agent();
    const saved = createWorkResult(actor, { requestId: 'with-native', body: 'Finished code', independentReview: {
      body: 'No actionable findings. Inspected the files and existing tests.',
      provenance: { method: 'native_review', independence: 'observed', nativeReviewId: 'agent-asserted-review' },
    } }).result;
    const detail = getWorkResult(saved.id)!;
    expect(detail.aiReviews).toHaveLength(1);
    expect(detail.aiReviews[0].provenance.independence).toBe('reported');
    expect(detail.aiReviews[0].scope.requested.resultId).toBe(saved.id);
    expect(detail.aiReviews[0].report).toBeTruthy();
    expect(listWorkResults()).toHaveLength(1);
    expect(getWorkResult(detail.aiReviews[0].report!.id)!.reviewTargetId).toBe(saved.id);
    expect(getWorkResult(detail.aiReviews[0].report!.id)!.taskIds).toEqual([]);
  });
});

describe('AI request and report conditional transitions', () => {
  it('deduplicates active compatible requests and conflicts on incompatible focus or settings', () => {
    const target = createWorkResult(human, { requestId: 'target', body: 'Work' }).result;
    const input = { requestId: 'one', resultId: target.id, brief: 'Original request', focus: 'correctness', selection, scope: scope(target.id), provenance: { method: 'fresh_session' as const, independence: 'observed' as const } };
    const first = createWorkResultAiReview(human, input);
    expect(createWorkResultAiReview(human, input).idempotentReplay).toBe(true);
    expect(createWorkResultAiReview(human, { ...input, requestId: 'two' }).review.id).toBe(first.review.id);
    expect(() => createWorkResultAiReview(human, { ...input, focus: 'different' })).toThrow(/different intent/);
    expect(() => createWorkResultAiReview(human, { ...input, requestId: 'three', selection: { ...selection, effort: 'high' } })).toThrow(/incompatible/);
    expect(getDb().select().from(workResultAiReviews).all()).toHaveLength(2);
    const equivalent = { ...input, requestId: 'two' };
    transitionWorkResultAiReview(first.review.id, 'queued', 'cancelled');
    setWorkResultCapabilities({ handoffsEnabled: false, aiReviewEnabled: false });
    expect(createWorkResultAiReview(human, equivalent).review.id).toBe(first.review.id);
    expect(() => createWorkResultAiReview(human, { ...equivalent, focus: 'changed-after-reuse' })).toThrow(/different intent/);
  });

  it('replays its original resolved settings when defaults change and capability is disabled', () => {
    const target = createWorkResult(human, { requestId: 'target', body: 'Work' }).result;
    const input = { requestId: 'same', resultId: target.id, brief: 'Original brief', selection, scope: scope(target.id), provenance: { method: 'fresh_session' as const, independence: 'observed' as const }, requestIntent: { resultId: target.id, focus: 'correctness' } };
    const saved = createWorkResultAiReview(human, input).review;
    setWorkResultCapabilities({ handoffsEnabled: true, aiReviewEnabled: false });
    const replay = createWorkResultAiReview(human, { ...input, selection: { ...selection, model: 'a-new-default' } });
    expect(replay.review.selection).toEqual(saved.selection);
    expect(() => createWorkResultAiReview(human, { ...input, requestId: 'new' })).toThrow(/disabled/);
  });

  it('limits reports to assigned reviewer, preserves requested scope and immutable completion retry', () => {
    const { result, review, reviewer } = requestedReview();
    const wrong = agent().actor;
    const input = { requestId: 'completion', reviewId: review.id, body: 'No actionable findings. I inspected the retained work.', scope: scope(result.id) };
    expect(() => reportWorkResultAiReview(wrong, input)).toThrow(/assigned reviewer/);
    expect(() => reportWorkResultAiReview(reviewer, { ...input, scope: scope('another-result') })).toThrow(/immutable/);
    const completed = reportWorkResultAiReview(reviewer, input);
    expect(completed.review.status).toBe('completed');
    expect(reportWorkResultAiReview(reviewer, input).report.id).toBe(completed.report.id);
    expect(() => reportWorkResultAiReview(reviewer, { ...input, body: 'Changed findings' })).toThrow(/different intent/);
    expect(transitionWorkResultAiReview(review.id, 'completed', 'failed', { statusReason: 'late-callback' })).toBeUndefined();
    expect(getWorkResultAiReview(review.id)!.status).toBe('completed');
    getDb().delete(chatSessions).where(eq(chatSessions.id, reviewer.sessionId!)).run();
    expect(reportWorkResultAiReview(reviewer, input).idempotentReplay).toBe(true);
    expect(getWorkResult(result.id)!.aiReviews[0].report?.body).toEqual(input.body);
    expect(getWorkResult(result.id)!.aiReviews[0].provenance.reviewerSessionId).toBe(reviewer.sessionId);
  });

  it('keeps caller revision assertions separate from trusted observed scope and replay intent', () => {
    const { result, review, reviewer } = requestedReview();
    transitionWorkResultAiReview(review.id, 'running', 'running', { provenance: {
      ...review.provenance, limitations: ['The adapter did not acknowledge applied effort.'],
    } });
    const input = { requestId: 'claims', reviewId: review.id, body: 'Reviewed code', scope: {
      ...scope(result.id), observed: { codeRevision: { commitSha: 'forged', workingTreeState: 'clean' as const, capturedAt: '2026-10-07T00:00:00Z' }, drift: false },
    }, provenance: { method: 'reported_review' as const, independence: 'reported' as const, limitations: ['Tests were unavailable.'] } };
    const observed = { codeRevision: { commitSha: 'actually-observed', workingTreeState: 'dirty' as const, capturedAt: '2026-10-07T01:00:00Z' }, drift: true };
    const saved = reportWorkResultAiReview(reviewer, input, observed);
    expect(saved.review.scope.observed?.codeRevision?.commitSha).toBe('actually-observed');
    expect(saved.review.scope.reported?.codeRevision?.commitSha).toBe('forged');
    expect(saved.review.scope.observed?.drift).toBe(true);
    expect(saved.review.provenance.method).toBe('fresh_session');
    expect(saved.review.provenance.limitations).toEqual(['The adapter did not acknowledge applied effort.', 'Tests were unavailable.']);
    expect(reportWorkResultAiReview(reviewer, input, { ...observed, drift: false }).review.scope.observed?.drift).toBe(true);
  });

  it('requires a report to complete and never resurrects cancelled or missing-report attempts', () => {
    const { review, reviewer } = requestedReview();
    expect(() => transitionWorkResultAiReview(review.id, 'running', 'completed')).toThrow(/committed review report/);
    transitionWorkResultAiReview(review.id, 'running', 'cancelled', { statusReason: 'user_cancelled' });
    expect(() => reportWorkResultAiReview(reviewer, { requestId: 'late', reviewId: review.id, body: 'Late output' })).toThrow(/Late reports/);
    expect(transitionWorkResultAiReview(review.id, 'cancelled', 'running')).toBeUndefined();
    expect(getDb().select().from(workResults).all()).toHaveLength(1);
  });

  it('blocks recursive reviewer primary reports and requests through the retained assignment', () => {
    const { review, reviewer, result } = requestedReview();
    expect(() => createWorkResult(reviewer, { requestId: 'recursive', body: 'Reviewing my review' })).toThrow(/report_result_review/);
    expect(() => createWorkResultAiReview(reviewer, { requestId: 'recursive-review', resultId: result.id, brief: 'Another review', selection, scope: scope(result.id), provenance: { method: 'fresh_session', independence: 'observed' } })).toThrow(/cannot request another/);
    const completed = reportWorkResultAiReview(reviewer, { requestId: 'report', reviewId: review.id, body: 'No actionable findings' });
    expect(() => createWorkResultAiReview(human, { requestId: 'review-report', resultId: completed.report.id, brief: 'Recursive report review', selection, scope: scope(completed.report.id), provenance: { method: 'fresh_session', independence: 'observed' } })).toThrow(/nested evidence/);
  });
});

describe('disable admission and durable decisions', () => {
  it('keeps reads and committed retries while rejecting fresh work and decisions', () => {
    const input = { requestId: 'saved', body: 'Durable work' };
    const saved = createWorkResult(human, input).result;
    const decision = { requestId: 'accepted', resultId: saved.id, disposition: 'accepted' as const };
    createWorkResultDecision(human, decision);
    setWorkResultCapabilities({ handoffsEnabled: false, aiReviewEnabled: false });
    expect(getWorkResult(saved.id)).toBeTruthy();
    expect(createWorkResult(human, input).idempotentReplay).toBe(true);
    expect(createWorkResultDecision(human, decision).idempotentReplay).toBe(true);
    expect(() => createWorkResult(human, { ...input, requestId: 'fresh' })).toThrow(/disabled/);
    expect(() => createWorkResultDecision(human, { ...decision, requestId: 'fresh-decision' })).toThrow(/disabled/);
  });

  it('allows only the authorized running preparation identity to finish after disable', () => {
    const { actor, session } = agent();
    const requestId = 'admitted-preparation';
    const id = workResultRequestScopedId('prepare_message', human, requestId);
    const operation = ensureWorkResultOperationMessage(human, { id, runId: workResultRequestScopedId('prepare_run', human, requestId), sessionId: session.id,
      content: 'Prepare existing work and report_result with this exact request_id', metadata: { kind: 'handoff_preparation', requestId, requestHash: 'hash', actorUserId: human.userId, actorSessionId: null, messageId: id } });
    setWorkResultCapabilities({ handoffsEnabled: false, aiReviewEnabled: false });
    expect(() => createWorkResult(actor, { requestId, body: 'Queued is not admitted running work' })).toThrow(/disabled/);
    getRawDb().prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(operation.run.id);
    expect(() => createWorkResult(actor, { requestId: 'unrelated', body: 'Unrelated new work' })).toThrow(/disabled/);
    expect(createWorkResult(actor, { requestId, body: 'Prepared durable handoff' }).result.body).toBe('Prepared durable handoff');
  });

  it('derives selected output provenance and binds disabled completion to exact supersession', () => {
    const { actor, session } = agent();
    const original = createWorkResult(actor, { requestId: 'original', body: 'First version' }).result;
    const sourceId = 'selected-output';
    getDb().insert(chatEvents).values({ id: sourceId, sessionId: session.id, role: 'assistant', source: 'agent', content: 'Updated useful work' }).run();
    const requestId = 'update-admitted';
    const messageId = workResultRequestScopedId('update-message', human, requestId);
    const admitted = ensureWorkResultOperationMessage(human, { id: messageId, runId: workResultRequestScopedId('update-run', human, requestId), sessionId: session.id,
      content: 'Prepare this exact successor', metadata: { kind: 'handoff_preparation', requestId, requestHash: 'hash', actorUserId: human.userId, actorSessionId: null, messageId, resultId: original.id, sourceEventId: sourceId } });
    getRawDb().prepare("UPDATE runs SET status='running' WHERE id=?").run(admitted.run.id);
    setWorkResultCapabilities({ handoffsEnabled: false, aiReviewEnabled: false });
    expect(() => createWorkResult(actor, { requestId, body: 'Unrelated new result' })).toThrow(/exact admitted/);
    const updated = createWorkResult(actor, { requestId, body: 'Second version', supersedesId: original.id }).result;
    expect(updated.sourceEventId).toBe(sourceId);
    expect(updated.supersedesId).toBe(original.id);
  });

  it('lets the admitted assigned review finish without enabling follow-on reviews', () => {
    const { result, review, reviewer } = requestedReview();
    setWorkResultCapabilities({ handoffsEnabled: false, aiReviewEnabled: false });
    const report = reportWorkResultAiReview(reviewer, { requestId: 'finish', reviewId: review.id, body: 'No actionable findings' });
    expect(report.review.status).toBe('completed');
    expect(getWorkResult(result.id)!.aiReviews[0].report?.id).toBe(report.report.id);
    expect(() => createWorkResultAiReview(human, { requestId: 'follow-on', resultId: result.id, brief: 'Review again', selection, scope: scope(result.id), provenance: { method: 'fresh_session', independence: 'observed' } })).toThrow(/disabled/);
  });

  it('uses append-only actor attribution and exact feedback delivery identity without completing tasks', () => {
    const { actor, session } = agent();
    const saved = createWorkResult(actor, { requestId: 'work', body: 'Work to inspect' }).result;
    const selectedReview = reportWorkResultAiReview(human, { requestId: 'selected-findings', resultId: saved.id, body: 'A requirement is missing' }).review;
    const input = { requestId: 'feedback', resultId: saved.id, disposition: 'changes_requested' as const, note: 'Fix the missing requirement', feedbackSessionId: session.id, feedbackMessageId: 'message-identity', context: { reviewId: selectedReview.id } };
    const feedback = createWorkResultDecision(human, input).review;
    expect(createWorkResultDecision(human, input).idempotentReplay).toBe(true);
    expect(() => createWorkResultDecision(human, { ...input, note: 'Changed feedback' })).toThrow(/different intent/);
    expect(feedback.actorSource).toBe('human');
    expect(feedback.feedbackMessageId).toBe('message-identity');
    const acceptance = createWorkResultDecision(actor, { requestId: 'agent-accept', resultId: saved.id, disposition: 'accepted' }).review;
    expect(acceptance.actorSource).toBe('ai');
    expect(getDb().select().from(workResultDecisions).all()).toHaveLength(2);
    expect(() => createWorkResultDecision(human, { requestId: 'empty-feedback', resultId: saved.id, disposition: 'changes_requested', note: ' ' })).toThrow(/requires feedback/);
    getDb().delete(chatSessions).where(eq(chatSessions.id, session.id)).run();
    setWorkResultCapabilities({ handoffsEnabled: false });
    expect(createWorkResultDecision(human, { requestId: input.requestId, resultId: input.resultId, disposition: input.disposition, note: input.note, context: input.context }).idempotentReplay).toBe(true);
  });

  it('keeps latest disposition in actual write order for hash-derived request IDs', () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-07T02:00:00Z').valueOf());
    try {
      const saved = createWorkResult(human, { requestId: 'target', body: 'Useful work' }).result;
      createWorkResultDecision(human, { requestId: 'z-accept', resultId: saved.id, disposition: 'accepted' });
      createWorkResultDecision(human, { requestId: 'a-dismiss', resultId: saved.id, disposition: 'dismissed' });
      createWorkResultDecision(human, { requestId: 'm-changes', resultId: saved.id, disposition: 'changes_requested', note: 'One requirement is missing' });
      expect(getWorkResult(saved.id)!.reviews.map((review) => review.disposition)).toEqual(['changes_requested', 'dismissed', 'accepted']);
    } finally { vi.restoreAllMocks(); }
  });
});

describe('work result tables on an upgraded home', () => {
  it('preserves existing task rowids and content while the release history adds the work result tables', () => {
    const folder = path.join(root, 'old-migrations');
    fs.mkdirSync(path.join(folder, 'meta'), { recursive: true });
    const source = path.join(process.cwd(), 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(source, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
    const oldEntries = journal.entries.filter((entry) => /^(0000|0001)_/.test(entry.tag));
    fs.writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: oldEntries }));
    for (const entry of oldEntries) fs.copyFileSync(path.join(source, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
    const db = new Database(path.join(root, 'upgrade.db'));
    try {
      runMigrations(db, folder);
      db.prepare("INSERT INTO tasks(rowid,id,title,status,raw_input) VALUES (321,'prior-task','Preserved content','todo','original request')").run();
      expect(runMigrations(db, source)).toEqual({ applied: journal.entries.length - oldEntries.length });
      expect(db.prepare('SELECT rowid,title,status FROM tasks WHERE id = ?').get('prior-task')).toEqual({ rowid: 321, title: 'Preserved content', status: 'todo' });
      for (const table of ['work_results', 'work_result_tasks', 'work_result_decisions', 'work_result_ai_reviews']) {
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)).toEqual({ name: table });
      }
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally { db.close(); }
  });
});

describe('ordinary transcript and task isolation', () => {
  it('preserves main replay completeness and chronological rows for hash-derived, backdated and pruned cursors', () => {
    const { actor, session } = agent();
    const nextId = '01900000-0000-7000-8000-000000000002';
    let requestId = 'sse-handoff';
    for (let i = 0; workResultRequestScopedId('result_event', actor, requestId) <= nextId; i++) requestId = `sse-handoff-${i}`;
    const handoff = createWorkResult(actor, { requestId, body: 'Saved handoff at a real transcript position' }).result;
    const event = getDb().select().from(chatEvents).where(eq(chatEvents.sessionId, session.id)).get()!;
    const at = event.createdAt;
    getDb().insert(chatEvents).values({ id: nextId, sessionId: session.id, role: 'assistant', source: 'agent', content: 'The ordinary conversation continues', createdAt: at, updatedAt: at }).run();
    expect(event.id > nextId).toBe(true);
    expect(listChatEventsToResume(session.id, event.id, null).rows.map((row) => row.id)).toEqual([nextId]);
    const backdatedId = '00000000-0000-7000-8000-000000000001';
    getDb().insert(chatEvents).values({ id: backdatedId, sessionId: session.id, role: 'assistant', source: 'agent', content: 'Clock drift cannot hide newly appended output',
      createdAt: new Date(Date.parse(at) - 1000).toISOString(), updatedAt: at }).run();
    expect(listChatEventsToResume(session.id, event.id, null).rows.map((row) => row.id)).toEqual([backdatedId, nextId]);
    expect(listChatEventsToResume(session.id, nextId, null, 1).rows.map((row) => row.id)).toEqual([backdatedId]);
    expect(listChatEventsToResume(session.id, backdatedId, null)).toEqual({ rows: [], complete: true });
    getDb().delete(chatEvents).where(eq(chatEvents.id, event.id)).run();
    expect(listChatEventsToResume(session.id, event.id, null)).toEqual({ rows: [], complete: false });
    expect(listChatEventsToResume(session.id, event.id, null, 1)).toEqual({ rows: [], complete: false });
    expect(listChatEventsToResume(session.id, backdatedId, null)).toEqual({ rows: [], complete: true });
    expect(getWorkResult(handoff.id)).toBeTruthy();
  });

  it('excludes reviewer narration and running state from legacy output obligations and task activity', () => {
    const { execution, session } = agent();
    const task = createTask({ title: 'Ordinary implementation task' });
    attachExecutionToTask(execution.id, task.id);
    const reviewer = createChatSession({ harness: 'codex', type: 'execution', executionId: execution.id, surfaceKind: 'result_review' });
    getDb().insert(chatEvents).values({ id: 'reviewer-output', sessionId: reviewer.id, role: 'assistant', source: 'agent', content: 'Independent findings', createdAt: new Date(Date.now() + 1000).toISOString() }).run();
    expect(getExecutionReviewContext(execution.id).latestOutputEventId).toBeNull();
    expect(getExecutionReviewContext(execution.id).hasUnreviewedOutput).toBe(false);
    expect(getTaskAttentionSignals(task.id, new Set([reviewer.id])).working).toBe(false);
    getDb().insert(chatEvents).values({ id: 'ordinary-output', sessionId: session.id, role: 'assistant', source: 'agent', content: 'Implementation output', createdAt: new Date(Date.now() + 2000).toISOString() }).run();
    expect(getExecutionReviewContext(execution.id).latestOutputEventId).toBe('ordinary-output');
    expect(getTaskAttentionSignals(task.id, new Set([session.id])).working).toBe(true); // Main shows live authoring alongside output awaiting review.
  });
});
