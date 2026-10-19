import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkResultRecord } from '@/db/types';
import type { PrResponse } from '@/lib/api/sessions';

const state = vi.hoisted(() => ({ data: undefined as PrResponse | undefined, error: null as Error | null,
  isPending: false, isLoading: false, isFetching: false, dataUpdatedAt: 0 }));
const readPr = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-execution-actions', () => ({ useSessionPr: (id: string | null) => { readPr(id); return state; } }));

import { ResultGithubChecks } from './result-github-checks';

const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
function result(overrides: Partial<WorkResultRecord> = {}): WorkResultRecord {
  return { sourceChatSessionId: 'author', body: 'Agent reports tests passed',
    codeRevision: { commitSha: sha, workingTreeState: 'clean', capturedAt: '2026-10-07' }, ...overrides } as WorkResultRecord;
}
function render(overrides: Partial<WorkResultRecord> = {}) {
  return renderToStaticMarkup(createElement(ResultGithubChecks, { result: result(overrides) }));
}

beforeEach(() => {
  readPr.mockClear();
  Object.assign(state, { data: { pr: { number: 17, url: 'https://github.com/team/repo/pull/17',
    state: 'OPEN', isDraft: false, headRefName: 'feature', baseRefName: 'main',
    title: 'Deliver the feature', updatedAt: '2026-10-07T12:00:00Z', mergeable: null,
    reviewDecision: null, autoMergeEnabled: false, outOfDate: false,
    headSha: sha, checks: { state: 'passing', total: 2, passed: 2, failed: 0, pending: 0 } } } satisfies PrResponse,
  error: null, isPending: false, isLoading: false, isFetching: false, dataUpdatedAt: Date.parse('2026-10-07T12:00:00Z') });
});

describe('live GitHub evidence beside a saved handoff', () => {
  it('binds checks only to the exact saved clean commit and labels its live observation', () => {
    const html = render();
    expect(html).toContain('GitHub checks (live)');
    expect(html).toContain(`Checks for saved commit <code>${sha}</code>`);
    expect(html).toContain('GitHub reports passing checks: 2 passed, 0 failed, 0 pending.');
    expect(html).toContain('2026-10-07T12:00:00.000Z');
    expect(html).toContain('This live status can change.');
    expect(html).toContain('https://github.com/team/repo/pull/17/checks');
    expect(html).not.toContain('Agent reports tests passed');
    expect(html).not.toContain('Verified');
    expect(readPr).toHaveBeenCalledWith('author');
  });

  it.each(['failing', 'pending'] as const)('preserves the observed %s state for a matching commit', (checkState) => {
    state.data!.pr!.checks = { state: checkState, total: 2, passed: 1,
      failed: checkState === 'failing' ? 1 : 0, pending: checkState === 'pending' ? 1 : 0 };
    expect(render()).toContain(`GitHub reports ${checkState} checks`);
  });

  it('keeps newer-head check success separate from the saved handoff', () => {
    state.data!.pr!.headSha = otherSha;
    const html = render();
    expect(html).toContain('Unknown for this handoff. The pull request now points to a different commit.');
    expect(html).toContain(`Saved commit: <code>${sha}</code>`);
    expect(html).toContain(`Live GitHub head: <code>${otherSha}</code>`);
    expect(html).not.toContain('passing checks');
    expect(html).not.toContain('2 passed');
  });

  it.each(['dirty', 'unknown'] as const)('does not bind a %s saved working copy to same-SHA checks', (workingTreeState) => {
    const html = render({ codeRevision: { commitSha: sha, workingTreeState, capturedAt: 'today' } });
    expect(html).toContain('Unknown for this handoff. The saved handoff has no known clean commit binding.');
    expect(html).not.toContain('passing checks');
  });

  it('does not bind checks when the saved code revision is missing', () => {
    expect(render({ codeRevision: null })).toContain('no known clean commit binding');
    expect(render({ codeRevision: null })).not.toContain('passing checks');
  });

  it('does not bind checks when GitHub did not supply its exact head', () => {
    state.data!.pr!.headSha = null;
    const html = render();
    expect(html).toContain('GitHub did not report the pull request head revision.');
    expect(html).not.toContain('passing checks');
  });

  it('shows missing checks without claiming they passed', () => {
    state.data!.pr!.checks = null;
    const html = render();
    expect(html).toContain('No GitHub checks reported for this commit.');
    expect(html).not.toContain('passing checks');
  });

  it('does not upgrade cached passing checks when the current API observation fails', () => {
    state.error = new Error('offline');
    const html = render();
    expect(html).toContain('Unknown for this handoff. Live GitHub check status is unavailable.');
    expect(html).not.toContain('passing checks');
    expect(html).not.toContain('Last observed');
  });

  it('keeps absent source provenance readable as unknown without selecting another session', () => {
    state.data = undefined;
    state.isPending = true;
    const html = render({ sourceChatSessionId: null });
    expect(html).toContain('Unknown for this handoff. The authoring conversation is unavailable.');
    expect(html).not.toContain('passing checks');
    expect(readPr).toHaveBeenCalledWith(null);
  });

  it('keeps an unavailable PR unknown and hides irrelevant non-code context', () => {
    state.data = { pr: null };
    expect(render()).toContain('No linked pull request is available.');
    expect(render({ codeRevision: null, sourceChatSessionId: null })).toBe('');
  });

  it('does not present a disabled PR query as perpetual loading while source scope is unavailable', () => {
    state.data = undefined;
    state.isPending = true;
    expect(render()).toContain('Live GitHub check status has not been observed.');
    expect(render()).not.toContain('Loading live GitHub checks.');
    state.isLoading = true;
    expect(render()).toContain('Loading live GitHub checks.');
  });
});
