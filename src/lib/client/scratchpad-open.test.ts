import { describe, expect, it } from 'vitest';
import { nextScratchpadAction } from './scratchpad-open';

/** ⌘⇧J gets you to the scratchpad's caret and back (docs/scratchpad.md). */
describe('nextScratchpadAction', () => {
  it('opens a closed pad', () => {
    expect(nextScratchpadAction(false, false, true)).toBe('open');
    expect(nextScratchpadAction(false, false, false)).toBe('open');
  });

  it('puts the caret in a pad that is open while you work elsewhere', () => {
    expect(nextScratchpadAction(true, false, true)).toBe('focus');
    expect(nextScratchpadAction(true, false, false)).toBe('focus');
  });

  it('goes back from the pad beside the page and leaves it in view', () => {
    expect(nextScratchpadAction(true, true, true)).toBe('return');
  });

  it('closes a sheet over the page', () => {
    expect(nextScratchpadAction(true, true, false)).toBe('close');
  });
});
