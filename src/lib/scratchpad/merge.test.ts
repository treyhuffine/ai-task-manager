import { describe, expect, it } from 'vitest';
import { mergeScratchpad } from './merge';

/** Two devices saving the same scratchpad (docs/scratchpad.md, "Every device"). */
describe('mergeScratchpad', () => {
  it('takes the local text when nothing else wrote since', () => {
    expect(mergeScratchpad('a', 'a\n\nb', 'a')).toBe('a\n\nb');
  });

  it('takes the stored text when the local side changed nothing', () => {
    expect(mergeScratchpad('a', 'a', 'a\n\nfrom the phone')).toBe('a\n\nfrom the phone');
    expect(mergeScratchpad('a', 'same', 'same')).toBe('same');
  });

  it('keeps the lines both devices added at the end, the stored ones first', () => {
    const base = 'Quotes';
    const phone = 'Quotes\n\nCall the insurer';
    const desk = 'Quotes\n\n- [ ] Backfill GEX history';
    expect(mergeScratchpad(base, desk, phone)).toBe('Quotes\n\nCall the insurer\n\n- [ ] Backfill GEX history');
  });

  it('lands edits made in different places where they were made', () => {
    expect(mergeScratchpad('A\n\nB\n\nC', 'A\n\nA2\n\nB\n\nC', 'A\n\nB\n\nC\n\nD')).toBe('A\n\nA2\n\nB\n\nC\n\nD');
  });

  it('keeps a line removed on one device removed when the other left it alone', () => {
    expect(mergeScratchpad('a\n\nb\n\nc', 'a\n\nc', 'a\n\nb\n\nc\n\nd')).toBe('a\n\nc\n\nd');
    expect(mergeScratchpad('a\n\nb\n\nc', 'a\n\nb\n\nc\n\nd', 'a\n\nc')).toBe('a\n\nc\n\nd');
  });

  it('checks off an item in place while the other device adds below', () => {
    expect(mergeScratchpad('- [ ] ship it\n\nx', '- [x] ship it\n\nx', '- [ ] ship it\n\nx\n\ny')).toBe('- [x] ship it\n\nx\n\ny');
  });

  it('keeps both versions of a line both devices changed', () => {
    expect(mergeScratchpad('idea', 'idea one', 'idea two')).toBe('idea two\n\nidea one');
    expect(mergeScratchpad('- a', '- a local', '- a remote')).toBe('- a remote\n- a local');
  });

  it('keeps a new empty line at the end after the other side’s line, so typing goes on there', () => {
    expect(mergeScratchpad('Team', 'Team\n\n', 'Team\n\nPhone')).toBe('Team\n\nPhone\n\n');
  });

  it('adds a line both devices wrote in the same place once', () => {
    expect(mergeScratchpad('a', 'a\n\nshared', 'a\n\nshared\n\nmore')).toBe('a\n\nshared\n\nmore');
  });

  it('never loses typing when the stored text was emptied', () => {
    expect(mergeScratchpad('old', 'old\n\nnew', '').trim()).toBe('old\n\nnew');
  });

  it('still merges versions too far apart to line up, by adding the new lines after', () => {
    const base = Array.from({ length: 1200 }, (_, i) => `base ${i}`).join('\n');
    const local = Array.from({ length: 1200 }, (_, i) => `local ${i}`).join('\n');
    const remote = Array.from({ length: 1200 }, (_, i) => `remote ${i}`).join('\n');
    const merged = mergeScratchpad(base, local, remote);
    expect(merged.startsWith('remote 0')).toBe(true);
    expect(merged.endsWith('local 1199')).toBe(true);
  });
});
