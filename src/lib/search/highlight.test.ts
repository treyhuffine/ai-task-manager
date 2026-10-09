import { describe, expect, it } from 'vitest';
import { containsAllTerms, highlightTerms, MAX_SEARCH_TERMS, searchTerms } from './highlight';

const marked = (text: string, terms: string[]) =>
  highlightTerms(text, terms)
    .map((s) => (s.highlighted ? `[${s.text}]` : s.text))
    .join('');

describe('searchTerms', () => {
  it('splits on whitespace and drops double quotes, keeping apostrophes', () => {
    expect(searchTerms('  "deploy  pipeline"  ')).toEqual(['deploy', 'pipeline']);
    expect(searchTerms("Maya's notes")).toEqual(["Maya's", 'notes']);
    expect(searchTerms('   ')).toEqual([]);
  });

  it(`keeps at most ${MAX_SEARCH_TERMS} words`, () => {
    expect(searchTerms('a b c d e f g h i j')).toHaveLength(MAX_SEARCH_TERMS);
  });
});

describe('containsAllTerms', () => {
  it('needs every word, in any order and case', () => {
    expect(containsAllTerms('Fix the Deploy pipeline', ['pipeline', 'DEPLOY'])).toBe(true);
    expect(containsAllTerms('Fix the Deploy pipeline', ['pipeline', 'budget'])).toBe(false);
    expect(containsAllTerms('anything', [])).toBe(false);
  });
});

describe('highlightTerms', () => {
  it('marks every occurrence of every word, ignoring case', () => {
    expect(marked('Deploy the deploy pipeline', ['DEPLOY', 'pipe'])).toBe('[Deploy] the [deploy] [pipe]line');
  });

  it('prefers the longer word where two start at the same place', () => {
    expect(marked('pipeline', ['pipe', 'pipeline'])).toBe('[pipeline]');
  });

  it('treats regex characters as text', () => {
    expect(marked('Roll out to 50% (beta)', ['(beta)', '50%'])).toBe('Roll out to [50%] [(beta)]');
    expect(marked('a.b and axb', ['a.b'])).toBe('[a.b] and axb');
  });

  it('returns the text unmarked without words, and nothing for no text', () => {
    expect(highlightTerms('Plain', [])).toEqual([{ text: 'Plain', highlighted: false }]);
    expect(highlightTerms('', ['x'])).toEqual([]);
  });
});
