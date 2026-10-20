import { describe, expect, it } from 'vitest';
import { countWords } from './word-count';

describe('countWords', () => {
  it('counts nothing in an empty or whitespace body', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  \n\t ')).toBe(0);
  });

  it('counts words across lines and runs of whitespace', () => {
    expect(countWords('one two\n\nthree   four')).toBe(4);
  });

  it('leaves out markdown punctuation that stands alone', () => {
    expect(countWords('## Heading\n\n- [ ] task\n> quote')).toBe(3);
    expect(countWords('# \n-\n**bold** _it_')).toBe(2);
  });
});
