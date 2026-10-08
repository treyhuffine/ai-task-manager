import { describe, expect, it } from 'vitest';
import type { WorkResultRecord, WorkResultAiReviewRecord, WorkResultDecisionRecord } from '@/db/types';
import { dispositionLabel, refreshResultOperationEvent, resultEventId, resultLinkUrl, resultReviewLabel, reviewReportExcerpt } from './presentation';

const result = { codeRevision: null } as WorkResultRecord;
const review = {
  status: 'completed', statusReason: null,
  provenance: { method: 'fresh_session', independence: 'observed' },
  scope: { requested: {}, observed: {} },
} as WorkResultAiReviewRecord;

describe('handoff evidence presentation', () => {
  it('keeps reported independence distinct from observed review', () => {
    expect(resultReviewLabel({ ...review, provenance: { method: 'reported_review', independence: 'reported' } }, result, false)).toBe('Agent reports an AI review');
    expect(resultReviewLabel(review, result, false)).toBe('AI review recorded');
  });
  it('keeps the compact report excerpt readable without mixing later scope into the verdict', () => {
    expect(reviewReportExcerpt('# Review\n\n**Verdict:** No actionable defects found.\n\n## Scope\n\nInspected the saved file.')).toBe('Verdict: No actionable defects found.');
    expect(reviewReportExcerpt('# Review\n\nTarget: `exact-id`.\n\n**Result: one actionable finding.**\n\n## Scope\n\nInspected the saved file.')).toBe('Result: one actionable finding.');
  });
  it('never upgrades missing reports, uncertain working copies or historical scopes', () => {
    expect(resultReviewLabel({ ...review, status: 'failed', statusReason: 'missing_report' }, result, false)).toBe('AI review ended without a report');
    expect(resultReviewLabel(review, { ...result, codeRevision: { commitSha: 'abc', workingTreeState: 'dirty', capturedAt: 'now' } }, false)).toContain('identity uncertain');
    expect(resultReviewLabel(review, result, true)).toContain('earlier work snapshot');
    expect(resultReviewLabel({ ...review, scope: { requested: review.scope.requested } }, result, false)).toContain('scope unknown');
  });
  it('identifies an AI acceptance as agent acceptance', () => {
    expect(dispositionLabel({ disposition: 'accepted', actorSource: 'ai', actorUserId: 'local' } as WorkResultDecisionRecord)).toBe('Accepted by agent');
  });
  it('rejects executable, filesystem and malformed result link destinations', () => {
    for (const unsafe of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/report', '/api/action', 'bad']) expect(resultLinkUrl(unsafe)).toBeNull();
    expect(resultLinkUrl('https://example.com/report')).toBe('https://example.com/report');
  });
  it('renders only explicitly saved work as a durable handoff', () => {
    expect(resultEventId({ source: 'agent', content: 'done', raw: { resultId: 'r1' } })).toBeNull();
    expect(resultEventId({ source: 'result', content: 'done', raw: { resultId: 'r1' } })).toBeNull();
    expect(resultEventId({ source: 'work_result', content: null, raw: { resultId: 'r1' } })).toBe('r1');
  });
  it('updates a queued preparation to its durable terminal delivery without duplicating its message', () => {
    const first = { id: 'message', raw: { resultOperation: { kind: 'handoff_preparation', status: 'queued' } } };
    const cancelled = { id: 'message', raw: { resultOperation: { kind: 'handoff_preparation', status: 'cancelled', statusReason: 'feature_disabled' } } };
    expect(refreshResultOperationEvent([first], cancelled)).toEqual([cancelled]);
    expect(refreshResultOperationEvent([cancelled], cancelled)[0]).toBe(cancelled);
    const ordinary: Array<{ id: string; raw: unknown }> = [{ id: 'ordinary', raw: null }];
    expect(refreshResultOperationEvent(ordinary, { id: 'ordinary', raw: { payload: 'changed' } })).toBe(ordinary);
  });
});
