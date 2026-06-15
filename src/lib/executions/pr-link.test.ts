import { describe, it, expect } from 'vitest';
import { extractPullRequestUrl } from './pr-link';

describe('extractPullRequestUrl', () => {
  it('pulls the PR out of `gh pr create` output', () => {
    const out = 'https://github.com/treyhuffine/ai-task-manager/pull/402\n';
    expect(extractPullRequestUrl(out)).toEqual({
      url: 'https://github.com/treyhuffine/ai-task-manager/pull/402',
      repo: 'treyhuffine/ai-task-manager',
      number: 402,
    });
  });

  it('normalizes /files and query suffixes to the bare permalink', () => {
    const out = 'see https://github.com/o/r/pull/12/files?diff=split for the change';
    expect(extractPullRequestUrl(out)?.url).toBe('https://github.com/o/r/pull/12');
    expect(extractPullRequestUrl(out)?.number).toBe(12);
  });

  it('ignores issues and non-PR text', () => {
    expect(extractPullRequestUrl('https://github.com/o/r/issues/5')).toBeNull();
    expect(extractPullRequestUrl('no url here')).toBeNull();
    expect(extractPullRequestUrl(null)).toBeNull();
  });
});
