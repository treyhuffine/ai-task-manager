import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WorkResultAiReviewRecord, WorkResultRecord } from '@/db/types';

const cancel = vi.hoisted(() => ({ isPending: false, mutate: vi.fn() }));
vi.mock('@/hooks/use-results', () => ({ useCancelResultReview: () => cancel }));
vi.mock('@/hooks/use-session-stream', () => ({ useSessionStream: () => undefined }));
vi.mock('@/hooks/use-execution', () => ({ useRuntimeStatus: () => ({ data: { running: true } }) }));
vi.mock('@/components/executions/pending-input-overlay', () => ({ PendingInputArea: () => createElement('p', null, 'Persisted reviewer permission') }));
vi.mock('@/components/executions/execution-event', () => ({ ExecutionEvent: () => null }));
vi.mock('./result-body', () => ({ ResultBody: () => null }));
vi.mock('./result-artifacts', () => ({ ResultArtifacts: () => null }));

import { ResultAiReview } from './result-ai-review';

const result = { id: 'target', codeRevision: null } as WorkResultRecord;
const review = {
  id: 'review', resultId: 'target', status: 'running', statusReason: null,
  reviewerSessionId: 'dedicated-reviewer', focus: null,
  selection: { harness: 'claude', model: 'sonnet' },
  provenance: { method: 'fresh_session', independence: 'observed' },
  scope: { requested: {}, observed: {} },
  report: null,
} as WorkResultAiReviewRecord & { report: WorkResultRecord | null };

describe('persisted reviewer attention', () => {
  it('keeps dedicated cancel and permission response available without new-work actions', () => {
    const html = renderToStaticMarkup(createElement(ResultAiReview, { review, result, hasSuccessor: false, canFeedback: false, onFeedback: vi.fn() }));
    expect(html).toContain('>Cancel<');
    expect(html).toContain('Persisted reviewer permission');
    expect(html).not.toContain('Address findings');
    expect(html).not.toContain('Retry');
    expect(cancel.mutate).not.toHaveBeenCalled();
  });
  it('does not present an exited reviewer without a saved report as completed evidence', () => {
    const html = renderToStaticMarkup(createElement(ResultAiReview, { review: { ...review, status: 'failed', statusReason: 'missing_report' }, result, hasSuccessor: false, canFeedback: false, onFeedback: vi.fn() }));
    expect(html).toContain('AI review ended without a report');
    expect(html).not.toContain('AI review recorded');
    expect(html).not.toContain('Open saved AI report');
    expect(html).not.toContain('>Cancel<');
  });
});
