import { describe, it, expect } from 'vitest';
import { formatPrRef } from './format';
import type { PrMentionItem } from './types';

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
