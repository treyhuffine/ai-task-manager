import { describe, expect, it, vi } from 'vitest';
import type { WorkResultActor, WorkResultDetail, WorkspaceRecord, WorkspaceReviewDefaults } from '@/db/types';

const state = vi.hoisted(() => ({ defaults: null as WorkspaceReviewDefaults | null }));
vi.mock('@/lib/db/queries', () => ({
  getChatSessionWithExecution: () => ({ id: 'author', userId: 'local', workspaceId: 'research', executionId: null, worktreePath: null }),
  getExecution: () => null,
  chatPlacement: () => null, placementOf: () => null, getHome: () => null,
  getWorkResult: () => null,
  getWorkResultAuthorBriefEvent: () => null,
  getTask: () => null,
  getUserState: () => ({ defaultHarness: 'claude', defaultModel: 'opus', defaultEffort: 'high' }),
  getWorkspace: () => ({ id: 'research', reviewBeforeHandoff: true }),
  ensureHarnessSettings: (harness: string) => ({ defaultModel: harness === 'codex' ? 'gpt-5.5' : 'opus', defaultVariant: null, defaultEffort: harness === 'codex' ? 'medium' : 'high' }),
  listActiveWorkResultAiReviews: () => [],
  workResultRequestScopedId: () => 'saved-review',
  transitionWorkResultAiReview: vi.fn(), validateWorkResultAttachments: vi.fn(), transitionWorkResultOperationRun: vi.fn(), publishWorkResultOperationState: vi.fn(),
}));
vi.mock('./reviewer-preferences', () => ({ getWorkResultSourceWorkspace: () => ({ id: 'research', cwd: '/missing-review-dir', reviewBeforeHandoff: true, reviewDefaults: state.defaults }) as WorkspaceRecord }));
vi.mock('./capabilities', () => ({ aiReviewEnabled: () => true }));
vi.mock('./runtime', () => ({
  assignedWorkResultReviewBrief: () => 'Exact saved handoff review brief',
  bindWorkResultReviewRuntime: vi.fn(), compatibleWorkResultReviewEvidence: () => false,
  dispatchQueuedWorkResultOperations: vi.fn(), resolveWorkResultReviewerSelection: async () => { throw new Error('The saved reviewer is unavailable.'); },
}));
vi.mock('@/lib/harness/runtime', () => ({ getHarnessRuntime: vi.fn() }));
import { prepareAutomaticWorkResultReview } from './automatic';

const actor: WorkResultActor = { userId: 'local', source: 'ai', sessionId: 'author' };
const detail = {
  result: { id: 'saved', userId: 'local', sourceChatSessionId: 'author', sourceExecutionId: null,
    sourceEventId: null, createdAt: '2026-10-07T00:00:00Z', body: 'Memo', attachments: [], links: [],
    codeRevision: { commitSha: 'known-captured-sha', workingTreeState: 'clean', capturedAt: '2026-10-07T00:00:00Z' } },
  taskIds: [], aiReviews: [],
} as unknown as WorkResultDetail;

describe('durable unavailable automatic reviewer snapshot', () => {
  it('inherits the selected agent harness defaults without mixing global authoring settings', async () => {
    state.defaults = { harness: 'codex', model: null, variant: null, effort: null };
    const plan = await prepareAutomaticWorkResultReview(actor, actor.sessionId);
    const request = plan!(detail)!;
    expect(request.selection).toEqual({ harness: 'codex', model: 'gpt-5.5', variant: null, effort: 'medium' });
    expect(request.failureReason).toBe('reviewer_unavailable');
    expect(request.scope.requested.codeRevision?.commitSha).toBe('known-captured-sha');
    expect(request.scope.observed?.codeRevision).toBeNull();
  });

  it('keeps an unavailable saved model and effort visible without presenting them as observed', async () => {
    state.defaults = { harness: 'codex', model: 'unavailable-model', effort: 'ultra' };
    const request = (await prepareAutomaticWorkResultReview(actor, actor.sessionId))!(detail)!;
    expect(request.selection).toEqual({ harness: 'codex', model: 'unavailable-model', variant: null, effort: 'ultra' });
    expect(request.provenance).toMatchObject({ independence: 'unknown', automaticWorkspaceId: 'research' });
    expect(request.provenance.observedModel).toBeUndefined();
    expect(request.failureReason).toBe('reviewer_unavailable');
  });
});
