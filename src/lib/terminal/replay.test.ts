import { describe, expect, it } from 'vitest';
import { sliceReplay, type ReplayState } from './replay';

/** A ring holding every chunk, i.e. nothing evicted yet. */
function intact(...chunks: string[]): ReplayState {
  const chars = chunks.join('').length;
  return { chunks, emittedChars: chars, bufferChars: chars };
}

/** A ring that has dropped `evicted` characters off the front. */
function evicted(evictedChars: number, ...chunks: string[]): ReplayState {
  const held = chunks.join('').length;
  return { chunks, emittedChars: evictedChars + held, bufferChars: held };
}

describe('sliceReplay', () => {
  it('replays everything for a viewer that has seen nothing', () => {
    expect(sliceReplay(intact('hello ', 'world'))).toEqual({
      replay: 'hello world',
      gap: false,
    });
  });

  it('sends nothing to a viewer that is already current', () => {
    // The reconnect that caused the original bug: stream drops, comes
    // straight back, nothing was written in between. Replaying the ring
    // here is what duplicated the screen.
    const state = intact('hello world');
    expect(sliceReplay(state, state.emittedChars)).toEqual({ replay: '', gap: false });
  });

  it('sends only the tail written while the viewer was away', () => {
    expect(sliceReplay(intact('hello ', 'world'), 6)).toEqual({
      replay: 'world',
      gap: false,
    });
  });

  it('slices correctly when the cursor lands mid-chunk', () => {
    // Chunk boundaries are an artifact of how the PTY happened to flush,
    // so the cursor has no reason to align with them.
    expect(sliceReplay(intact('abcdef', 'ghijkl'), 9)).toEqual({
      replay: 'jkl',
      gap: false,
    });
  });

  it('flags a gap when the missed output has been evicted', () => {
    // 1000 chars written, only the last 10 still held, viewer last saw 5.
    // Everything between 5 and 990 is gone, so this cannot be spliced.
    const state = evicted(990, '0123456789');
    expect(sliceReplay(state, 5)).toEqual({ replay: '0123456789', gap: true });
  });

  it('does not flag a gap when the cursor sits exactly at the ring start', () => {
    // Boundary case: nothing the viewer needs has been evicted yet.
    const state = evicted(990, '0123456789');
    expect(sliceReplay(state, 990)).toEqual({ replay: '0123456789', gap: false });
  });

  it('treats an untrustworthy cursor as a fresh viewer', () => {
    const state = intact('hello');
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sliceReplay(state, bad)).toEqual({ replay: 'hello', gap: false });
    }
  });

  it('handles an empty ring', () => {
    const empty: ReplayState = { chunks: [], emittedChars: 0, bufferChars: 0 };
    expect(sliceReplay(empty)).toEqual({ replay: '', gap: false });
    expect(sliceReplay(empty, 0)).toEqual({ replay: '', gap: false });
  });

  it('never returns output the viewer already has', () => {
    // Property check across every cursor position: replaying from `since`
    // must reconstruct exactly the tail, with no overlap and no hole.
    const state = intact('the quick ', 'brown fox ', 'jumps');
    const full = 'the quick brown fox jumps';
    for (let since = 0; since <= full.length; since++) {
      expect(sliceReplay(state, since).replay).toBe(full.slice(since));
    }
  });
});
