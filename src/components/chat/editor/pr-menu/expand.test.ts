import { describe, it, expect } from 'vitest';
import { expandPrRefs, formatPrRef } from './expand';
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

const PRS = [PR_1];

describe('expandPrRefs', () => {
  it('expands a known PR reference', () => {
    expect(expandPrRefs('look at #1', PRS)).toBe(`look at ${formatPrRef(PR_1)}`);
  });

  it('leaves numbers with no matching PR alone', () => {
    expect(expandPrRefs('look at #42', PRS)).toBe('look at #42');
  });

  // Escaping out of the `#` menu means "I meant the characters I typed".
  // An escape hatch that still rewrote the text on the way to the agent
  // would not be one.
  it('leaves everything literal once the user has dismissed the menu', () => {
    expect(expandPrRefs('look at #1', PRS, { literal: true })).toBe('look at #1');
  });

  it('is a noop with no PRs cached', () => {
    expect(expandPrRefs('look at #1', [])).toBe('look at #1');
  });

  it('does not re-expand text a PR chip already produced', () => {
    const once = expandPrRefs('look at #1', PRS);
    expect(expandPrRefs(once, PRS)).toBe(once);
  });

  it('skips URL fragments and word-attached hashes', () => {
    expect(expandPrRefs('see /docs/page#1 and id#1 and ##1', PRS)).toBe(
      'see /docs/page#1 and id#1 and ##1',
    );
  });
});
