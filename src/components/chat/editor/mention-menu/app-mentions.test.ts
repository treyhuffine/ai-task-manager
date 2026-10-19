import { describe, expect, it, vi } from 'vitest';
import { appMentionItems, debouncedAppMentionSearch, shouldSearchAppMentions, APP_MENTIONS_MIXED } from './app-mentions';
import type { AppMentionResults } from './types';

const icon = { src: 'data:image/svg+xml,%3Csvg%2F%3E' };
const results: AppMentionResults = { groups: [
  { serverId: 'bits', app: 'Bits & Bolts', icons: [icon], items: Array.from({ length: 8 }, (_, i) => ({ sourceRef: `ref-${i}`, title: `Part ${i}`, ...(i === 0 ? { subtitle: 'keycap-agent.stl' } : {}), icons: [] })) },
  { serverId: 'docs', app: 'Docs', account: 'Work', icons: [], items: [{ sourceRef: 'doc-1', title: 'Plan', icons: [icon] }] },
] };

describe('when to ask apps', () => {
  it('asks in the mixed picker once something is typed, and always under @app:', () => {
    expect(shouldSearchAppMentions(null, '', false)).toBe(false);
    expect(shouldSearchAppMentions(null, '  ', false)).toBe(false);
    expect(shouldSearchAppMentions(null, 'key', false)).toBe(true);
    expect(shouldSearchAppMentions('app', '', false)).toBe(true);
    for (const filter of ['task', 'note', 'file', 'connector']) expect(shouldSearchAppMentions(filter, 'key', false)).toBe(false);
    expect(shouldSearchAppMentions(null, 'key', true)).toBe(false);
  });
});

describe('picker rows', () => {
  it('groups by app, five each in the mixed picker and every item under @app:', () => {
    const mixed = appMentionItems(results, false);
    expect(mixed.filter(item => item.serverId === 'bits')).toHaveLength(APP_MENTIONS_MIXED);
    expect(mixed[0]).toEqual({ kind: 'appMention', serverId: 'bits', group: 'Bits & Bolts', sourceRef: 'ref-0', title: 'Part 0', subtitle: 'keycap-agent.stl', icons: [], appIcons: [icon] });
    expect(mixed.at(-1)).toMatchObject({ group: 'Docs · Work', icons: [icon] });
    expect(appMentionItems(results, true).filter(item => item.serverId === 'bits')).toHaveLength(8);
    expect(appMentionItems(null, true)).toEqual([]);
  });
});

describe('debounced search', () => {
  it('asks once for the last query typed, and reuses a recent answer', async () => {
    vi.useFakeTimers();
    try {
      const search = vi.fn(async (query: string) => ({ groups: [{ serverId: 'bits', app: query, icons: [], items: [] }] }));
      const debounced = debouncedAppMentionSearch(search, { delayMs: 150 });
      const first = new AbortController();
      const typing = debounced('k', first.signal);
      const rejected = expect(typing).rejects.toMatchObject({ name: 'AbortError' });
      first.abort();
      await rejected;
      const latest = debounced('key', new AbortController().signal);
      await vi.advanceTimersByTimeAsync(150);
      expect((await latest)?.groups[0].app).toBe('key');
      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith('key', expect.any(AbortSignal));
      expect(await debounced('key')).toEqual({ groups: [{ serverId: 'bits', app: 'key', icons: [], items: [] }] });
      expect(search).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('asks again once a cached answer is stale', async () => {
    let now = 0;
    const search = vi.fn(async () => ({ groups: [] }));
    const debounced = debouncedAppMentionSearch(search, { delayMs: 0, ttlMs: 1000, now: () => now });
    await debounced('hex');
    now = 2000;
    await debounced('hex');
    expect(search).toHaveBeenCalledTimes(2);
  });
});
