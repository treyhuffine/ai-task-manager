import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkResultDetail } from '@/db/types';

const state = vi.hoisted(() => ({ enabled: false, aiEnabled: false, sourceAvailable: true, detail: null as WorkResultDetail | null }));
const mutation = { isPending: false, error: null, data: undefined, mutate: vi.fn(), mutateAsync: vi.fn() };

vi.mock('@/hooks/use-results', () => ({
  useResult: () => ({ data: state.detail, isLoading: false, error: null }),
  useResultCapabilities: () => ({ data: { handoffsEnabled: state.enabled, aiReviewEnabled: state.aiEnabled } }),
  useResultDecision: () => mutation,
  usePrepareHandoff: () => mutation,
  useRequestResultReview: () => mutation,
  useRetryResultFeedback: () => mutation,
  useAcceptResultComplete: () => mutation,
}));
vi.mock('./use-authoring-destination', () => ({ useAuthoringDestination: () => ({ available: state.sourceAvailable, reason: state.sourceAvailable ? null : 'Authoring conversation unavailable' }) }));
vi.mock('@/components/chat/message-file-chip', () => ({ MessageFileChip: ({ attachment }: { attachment: { originalName: string } }) => createElement('span', null, attachment.originalName) }));
vi.mock('./use-handoff-preparation', () => ({ useHandoffPreparation: () => null }));
vi.mock('./preparation-status', () => ({ PreparationStatus: () => null }));
vi.mock('@/hooks/use-session-stream', () => ({ useSessionStream: () => undefined }));
vi.mock('./result-body', () => ({ ResultBody: ({ result }: { result: { body: string } }) => createElement('p', null, result.body) }));
vi.mock('./result-artifacts', () => ({ ResultArtifacts: () => createElement('p', null, 'Retained files') }));
vi.mock('./result-github-checks', () => ({ ResultGithubChecks: () => createElement('p', null, 'Commit-bound live GitHub checks') }));
vi.mock('./result-ai-review', () => ({ ResultAiReview: () => createElement('p', null, 'Recorded AI review') }));
vi.mock('./result-feedback', () => ({ ResultFeedback: () => null }));
vi.mock('./reviewer-selection', () => ({ ReviewerSelection: () => createElement('span', null, 'Per-request selection') }));
vi.mock('@/components/ai-elements/message', () => ({ MessageResponse: ({ children }: { children: string }) => createElement('p', null, children) }));

import { ResultRenderer } from './result-renderer';

beforeEach(() => {
  vi.clearAllMocks();
  state.enabled = false;
  state.aiEnabled = false;
  state.sourceAvailable = true;
  state.detail = {
    result: { id: 'saved', title: 'Saved work', body: 'Durable explanation', createdAt: '2026-10-07', actorSource: 'ai', actorUserId: 'local', sourceChatSessionId: null, supersedesId: null, codeRevision: null },
    taskIds: [], reviews: [], aiReviews: [], supersedes: null, successor: null, successorId: null, reviewTargetId: null,
  } as unknown as WorkResultDetail;
});

describe('retained exact handoffs', () => {
  it('keeps saved content, files, provenance and decisions readable after disable', () => {
    state.detail!.reviews = [{ id: 'decision', createdAt: 'today', disposition: 'accepted', actorSource: 'human', actorUserId: 'local', note: 'Looks right' }] as WorkResultDetail['reviews'];
    const html = renderToStaticMarkup(createElement(ResultRenderer, { resultId: 'saved', exact: true }));
    expect(html).toContain('Durable explanation');
    expect(html).toContain('Retained files');
    expect(html).toContain('Handoff provenance');
    expect(html).toContain('Accepted by you');
    expect(html).not.toContain('Request changes');
    expect(html).not.toContain('Review with AI');
    expect(html).not.toContain('Update handoff');
    expect(mutation.mutate).not.toHaveBeenCalled();
  });
  it('offers handoff decisions independently of the AI review gate', () => {
    state.enabled = true;
    const html = renderToStaticMarkup(createElement(ResultRenderer, { resultId: 'saved' }));
    expect(html).toContain('View handoff');
    expect(html).toContain('Request changes');
    expect(html).toContain('>Accept<');
    expect(html).not.toContain('Review with AI');
    expect(mutation.mutate).not.toHaveBeenCalled();
  });
  it('keeps reviewer reports nested under their target without new review obligations', () => {
    state.enabled = true;
    state.aiEnabled = true;
    state.detail!.reviewTargetId = 'target';
    const html = renderToStaticMarkup(createElement(ResultRenderer, { resultId: 'saved', exact: true }));
    expect(html).toContain('View the reviewed handoff');
    expect(html).toContain('/results/target');
    expect(html).not.toContain('Review with AI');
    expect(html).not.toContain('Request changes');
    expect(html).not.toContain('>Accept<');
  });
  it('opens the exact historical snapshot and identifies a successor without inheriting acceptance', () => {
    state.detail!.successorId = 'successor';
    const html = renderToStaticMarkup(createElement(ResultRenderer, { resultId: 'saved', exact: true }));
    expect(html).toContain('Durable explanation');
    expect(html).toContain('Newer result available');
    expect(html).toContain('/results/successor');
    expect(html).not.toContain('Accepted by');
  });
  it('retains feedback files and records unavailable delivery without a replacement conversation', () => {
    state.enabled = true;
    state.sourceAvailable = false;
    state.detail!.reviews = [{ id: 'feedback', disposition: 'changes_requested', actorSource: 'human', actorUserId: 'local', note: 'See this screenshot', feedbackMessageId: null, attachments: [{ fileName: 'screenshot.png', originalName: 'Feedback screenshot', mimeType: 'image/png', size: 42, uploadedAt: 'today' }] }] as WorkResultDetail['reviews'];
    Object.assign(state.detail!, { feedbackDelivery: { feedback: { status: 'failed', statusReason: 'target_unavailable' } } });
    const html = renderToStaticMarkup(createElement(ResultRenderer, { resultId: 'saved', exact: true }));
    expect(html).toContain('Feedback screenshot');
    expect(html).toContain('Feedback saved. Delivery: failed (target unavailable)');
    expect(html).toContain('Request changes');
    expect(html).not.toContain('Update handoff');
    expect(mutation.mutate).not.toHaveBeenCalled();
  });
  it('allows safe persisted feedback delivery retry with feature gates off', () => {
    state.detail!.reviews = [{ id: 'feedback', disposition: 'changes_requested', actorSource: 'human', actorUserId: 'local', note: 'Saved request', attachments: [] }] as unknown as WorkResultDetail['reviews'];
    Object.assign(state.detail!, { feedbackDelivery: { feedback: { status: 'failed', statusReason: 'delivery_failed', canRetry: true } } });
    const html = renderToStaticMarkup(createElement(ResultRenderer, { resultId: 'saved', exact: true }));
    expect(html).toContain('Retry delivery');
    expect(html).not.toContain('Request changes');
    expect(html).not.toContain('Review with AI');
    expect(mutation.mutate).not.toHaveBeenCalled();
  });
  it('retains selected review, screenshot and preview context when the authoring conversation is gone', () => {
    state.sourceAvailable = false;
    state.detail!.result.attachments = [{ fileName: 'source.png', originalName: 'Original screenshot', mimeType: 'image/png', size: 42, uploadedAt: 'today' }];
    state.detail!.result.links = [{ kind: 'preview', label: 'Calculator preview', previewTargetId: 'target' }];
    state.detail!.reviews = [{ id: 'feedback', disposition: 'changes_requested', actorSource: 'human', actorUserId: 'local', note: 'Retained contextual feedback', attachments: [], context: { reviewId: 'ai-review', attachmentFileName: 'source.png', previewTargetId: 'target' } }] as unknown as WorkResultDetail['reviews'];
    const html = renderToStaticMarkup(createElement(ResultRenderer, { resultId: 'saved', exact: true }));
    expect(html).toContain('/results/saved#ai-review-ai-review');
    expect(html).toContain('Original screenshot');
    expect(html).toContain('/results/saved#preview-target');
    expect(html).toContain('Calculator preview');
    expect(html).not.toContain('Request changes');
  });
});
