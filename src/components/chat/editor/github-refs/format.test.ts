import { describe, it, expect } from 'vitest';
import { formatIssueRef, formatPrRef } from './format';
import type { IssueMentionItem, PrMentionItem } from './types';

const PR_1: PrMentionItem = {
  number: 1,
  title: 'Add SEO footer',
  headRefName: 'codex/seo-footer',
  baseRefName: 'main',
  state: 'OPEN',
  isDraft: false,
  url: 'https://github.com/owner/repo/pull/1',
  updatedAt: '2026-07-20T00:00:00.000Z',
};

const ISSUE_412: IssueMentionItem = {
  number: 412,
  title: 'Login loops on Safari',
  state: 'OPEN',
  url: 'https://github.com/owner/repo/issues/412',
  updatedAt: '2026-07-21T00:00:00.000Z',
};

describe('formatPrRef', () => {
  it('renders the single-line context string the agent sees', () => {
    expect(formatPrRef(PR_1)).toBe(
      'PR #1 "Add SEO footer" (head: codex/seo-footer, base: main, state: OPEN) https://github.com/owner/repo/pull/1',
    );
  });

  it('flags drafts inline so the agent knows the PR is not ready', () => {
    expect(formatPrRef({ ...PR_1, isDraft: true })).toContain('state: OPEN, draft)');
  });
});

describe('formatIssueRef', () => {
  it('renders the issue, its state and its link on one line', () => {
    expect(formatIssueRef(ISSUE_412)).toBe(
      'Issue #412 "Login loops on Safari" (state: OPEN) https://github.com/owner/repo/issues/412',
    );
  });

  it('says when the issue is closed', () => {
    expect(formatIssueRef({ ...ISSUE_412, state: 'CLOSED' })).toContain('(state: CLOSED)');
  });
});
