import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { markLaunchPending, clearLaunchPending, isLaunchPending } from './pending-launch';

describe('pending-launch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports an id as pending once marked', () => {
    markLaunchPending('a');
    expect(isLaunchPending('a')).toBe(true);
  });

  it('reports an unknown id as not pending', () => {
    expect(isLaunchPending('never-marked')).toBe(false);
  });

  it('treats null and empty ids as not pending', () => {
    // `useSession` passes its raw `id` through, which is nullable while no
    // execution is open. That must not read as "wait for a row".
    expect(isLaunchPending(null)).toBe(false);
    expect(isLaunchPending(undefined)).toBe(false);
    expect(isLaunchPending('')).toBe(false);
  });

  it('stops reporting pending after clear', () => {
    markLaunchPending('b');
    clearLaunchPending('b');
    expect(isLaunchPending('b')).toBe(false);
  });

  it('tracks ids independently', () => {
    markLaunchPending('c');
    markLaunchPending('d');
    clearLaunchPending('c');
    expect(isLaunchPending('c')).toBe(false);
    expect(isLaunchPending('d')).toBe(true);
  });

  it('expires an entry nothing ever cleared', () => {
    // The whole point of the ceiling: a create that dies without resolving or
    // rejecting (tab suspended, request aborted mid-flight) must not leave
    // `useSession` retrying 404s for the rest of the page's life.
    markLaunchPending('e');
    vi.advanceTimersByTime(89_000);
    expect(isLaunchPending('e')).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(isLaunchPending('e')).toBe(false);
  });

  it('is idempotent under a repeated clear', () => {
    markLaunchPending('f');
    clearLaunchPending('f');
    clearLaunchPending('f');
    expect(isLaunchPending('f')).toBe(false);
  });

  it('restarts the clock when an id is re-marked', () => {
    markLaunchPending('g');
    vi.advanceTimersByTime(80_000);
    markLaunchPending('g');
    vi.advanceTimersByTime(80_000);
    expect(isLaunchPending('g')).toBe(true);
  });
});
