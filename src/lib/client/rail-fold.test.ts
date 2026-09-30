import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { railFoldKey, setFoldShown } from './rail-fold';

/** Show/hide memory for the rail's folds: inactive executions and an agent's extra threads. */
describe('rail fold memory', () => {
  let store: Map<string, string>;
  let events: string[];

  beforeEach(() => {
    store = new Map();
    events = [];
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
      dispatchEvent: (e: Event) => {
        events.push(e.type);
        return true;
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps each section separate, and hidden is the absence of a key', () => {
    setFoldShown('inactive:agent:ws-1', true);
    expect(store.get(railFoldKey('inactive:agent:ws-1'))).toBe('1');
    expect(store.has(railFoldKey('more:agent:ws-1'))).toBe(false);

    setFoldShown('inactive:agent:ws-1', false);
    expect(store.has(railFoldKey('inactive:agent:ws-1'))).toBe(false);
  });

  it('tells every mounted copy of the section to re-read', () => {
    setFoldShown('unread', true);
    expect(events).toEqual(['ri:rail-fold-changed']);
  });

  it('survives storage that throws (private mode)', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
        removeItem: () => {
          throw new Error('denied');
        },
      },
      dispatchEvent: () => true,
    });
    expect(() => setFoldShown('unread', true)).not.toThrow();
  });
});
