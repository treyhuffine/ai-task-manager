import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readProviderEffort,
  readProviderEfforts,
  writeProviderEffort,
} from './provider-effort';

const KEY = 'flow.agent.effort.v1';

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  return store;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('provider effort memory', () => {
  it('round-trips one provider', () => {
    stubStorage();
    writeProviderEffort('codex', 'xhigh');
    expect(readProviderEffort('codex')).toBe('xhigh');
  });

  it('keeps providers independent — the reason this is a map', () => {
    stubStorage();
    writeProviderEffort('codex', 'xhigh');
    writeProviderEffort('claude', 'low');
    expect(readProviderEffort('codex')).toBe('xhigh');
    expect(readProviderEffort('claude')).toBe('low');
    expect(readProviderEfforts()).toEqual({ codex: 'xhigh', claude: 'low' });
  });

  it('returns null for a provider never set, so callers fall back', () => {
    stubStorage();
    expect(readProviderEffort('codex')).toBeNull();
    expect(readProviderEffort(null)).toBeNull();
    expect(readProviderEffort(undefined)).toBeNull();
  });

  it('refuses to persist a value outside the known ladder', () => {
    stubStorage();
    writeProviderEffort('codex', 'turbo' as never);
    expect(readProviderEffort('codex')).toBeNull();
  });

  it('drops invalid stored values on read rather than dispatching them', () => {
    // A value written by an older build must not flow into a dispatch.
    stubStorage({ [KEY]: JSON.stringify({ codex: 'turbo', claude: 'high' }) });
    expect(readProviderEfforts()).toEqual({ claude: 'high' });
  });

  it('survives corrupt storage', () => {
    stubStorage({ [KEY]: 'not json' });
    expect(readProviderEfforts()).toEqual({});
    stubStorage({ [KEY]: '["array"]' });
    expect(readProviderEfforts()).toEqual({});
  });

  it('is inert without a window (SSR)', () => {
    expect(() => writeProviderEffort('codex', 'high')).not.toThrow();
    expect(readProviderEffort('codex')).toBeNull();
  });

  it('ignores a null effort rather than clearing the entry', () => {
    stubStorage();
    writeProviderEffort('codex', 'high');
    writeProviderEffort('codex', null);
    expect(readProviderEffort('codex')).toBe('high');
  });
});
