import { describe, it, expect } from 'vitest';
import { gist, topic } from '../src/domain/briefings.js';

describe('briefing text without AI', () => {
  it('drops reply prefixes from subjects', () => {
    expect(topic('Re: RE: Fwd: Portfolio discussion')).toBe('Portfolio discussion');
    expect(topic('Re:')).toBe('Re:');
  });

  it('keeps whole sentences, drops a closing signature and never treats an opening thanks as one', () => {
    expect(gist('That would be wonderful, thank you. Could you bring an example to our call? Best, Maya Chen Design lead, Northstar maya.chen@northstar.example'))
      .toBe('That would be wonderful, thank you. Could you bring an example to our call?');
    expect(gist('Thank you. Could you bring an example of a complex product decision? Best, Maya Chen Design lead, Northstar'))
      .toBe('Thank you. Could you bring an example of a complex product decision?');
    expect(gist('Best wishes on the launch. Talk soon.')).toBe('Best wishes on the launch. Talk soon.');
  });

  it('stays within the limit, cutting a long first sentence at a word boundary', () => {
    const long = `${'word '.repeat(60)}end.`;
    const result = gist(long, 100);
    expect(result.length).toBeLessThanOrEqual(101);
    expect(result.endsWith('…')).toBe(true);
    expect(gist('One. Two. Three is longer than the rest of them.', 12)).toBe('One. Two.');
  });
});
