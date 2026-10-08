import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { setWorkResultCapabilities } from '@/lib/work-results/capabilities';
import { sessionCredential, SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';
import { resultsRouter } from './results-router';

let home: TestHome;
const human = { userId: 'local', source: 'human' as const };

function caller(sessionId?: string, scope: 'viewer' | 'session' = 'viewer') {
  const headers = new Headers(sessionId ? { [SESSION_CREDENTIAL_HEADER]: sessionCredential(sessionId, home.token)! } : {});
  return resultsRouter.createCaller({ request: new Request('http://localhost/api/trpc/results', { headers }),
    key: { apiKeyId: 'fixture-viewer', scope, location: 'home', workerDeviceId: null, sessionChatId: sessionId ?? null },
  });
}
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-results-trpc-' });
  setWorkResultCapabilities({ handoffsEnabled: true, aiReviewEnabled: true });
});
afterEach(async () => { await home.cleanup(); });

describe('durable results through shared typed procedures', () => {
  it('saves the selected answer verbatim and keeps retries and reads consistent', async () => {
    const chat = q.createChatSession({ type: 'orchestration', harness: 'codex' });
    const body = '    Indented Markdown\n\nA finished deliverable.\n';
    const event = q.insertChatEvent({ sessionId: chat.id, source: 'agent', role: 'assistant', content: body })!;
    const input = { requestId: 'typed-save', sourceChatSessionId: chat.id, sourceEventId: event.id, body };
    const api = caller();
    const saved = await api.save(input);
    expect(saved.replayed).toBe(false);
    expect(await api.save(input)).toMatchObject({ resultId: saved.resultId, replayed: true });
    expect(await api.get({ id: saved.resultId })).toMatchObject({ result: { id: saved.resultId, body }, taskIds: [] });
    expect(await api.list({ sourceChatSessionId: chat.id, sourceEventId: event.id })).toHaveLength(1);
    await expect(api.save({ ...input, title: 'Different intent' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(q.listWorkResults()).toHaveLength(1);
  });

  it('keeps saved records readable and committed retries available after disable', async () => {
    const chat = q.createChatSession({ type: 'orchestration', harness: 'codex' });
    const event = q.insertChatEvent({ sessionId: chat.id, source: 'agent', role: 'assistant', content: 'Finished work.' })!;
    const api = caller();
    const input = { requestId: 'before-disable', sourceChatSessionId: chat.id, sourceEventId: event.id, body: 'Finished work.' };
    const saved = await api.save(input);
    expect(await api.setCapabilities({ handoffsEnabled: false })).toEqual({ handoffsEnabled: false, aiReviewEnabled: false });
    expect(await api.get({ id: saved.resultId })).toMatchObject({ result: { id: saved.resultId } });
    expect(await api.save(input)).toMatchObject({ resultId: saved.resultId, replayed: true });
    await expect(api.save({ ...input, requestId: 'after-disable' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(q.listWorkResults()).toHaveLength(1);
  });

  it('retains reviewer target restrictions across the tRPC context adapter', async () => {
    const target = q.createWorkResult(human, { requestId: 'target', body: 'Work to inspect.' }).result;
    const other = q.createWorkResult(human, { requestId: 'other', body: 'Other work.' }).result;
    const review = q.createWorkResultAiReview(human, { requestId: 'assigned', resultId: target.id, brief: 'Inspect the exact target.',
      selection: { harness: 'codex', model: 'fixture-model', variant: null, effort: null },
      scope: { requested: { resultId: target.id, capturedAt: new Date().toISOString(), attachments: [] } },
      provenance: { method: 'fresh_session', independence: 'observed' },
    }).review;
    const chat = q.createChatSession({ type: 'orchestration', harness: 'codex', surfaceKind: 'result_review', surfaceRef: review.id });
    const run = q.createRun({ harness: 'codex', triggerKind: 'manual', chatSessionId: chat.id });
    q.linkWorkResultAiReviewRuntime(review.id, { reviewerSessionId: chat.id, runId: run.id });
    const reviewer = caller(chat.id);
    expect(await reviewer.get({ id: target.id })).toMatchObject({ result: { id: target.id } });
    await expect(reviewer.get({ id: other.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(reviewer.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(reviewer.decide({ id: target.id, requestId: 'reviewer-accept', disposition: 'accepted' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(reviewer.setCapabilities({ handoffsEnabled: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(q.getWorkResult(target.id)?.reviews).toEqual([]);
    expect(q.getWorkResult(other.id)?.reviews).toEqual([]);
  });

  it('rejects unsigned session viewers and invalid input before domain writes', async () => {
    await expect(caller(undefined, 'session').list({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller().save({ requestId: '', body: 'Work' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller().save({ requestId: 'blank', body: '   ' })).rejects.toMatchObject({ code: 'UNPROCESSABLE_CONTENT' });
    expect(q.listWorkResults()).toEqual([]);
  });
});
