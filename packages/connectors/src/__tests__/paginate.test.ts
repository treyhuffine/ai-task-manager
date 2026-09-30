/** Bounded cursor pagination shared by native provider adapters. */
import { describe, it, expect } from 'vitest';
import { collectPages } from '../core/paginate';
describe('collectPages', () => {
  it('follows the cursor across pages until it is empty', async () => {
    const pages: Record<string, { items: number[]; nextCursor?: string }> = {
      __start: { items: [1, 2], nextCursor: 'b' },
      b: { items: [3, 4], nextCursor: 'c' },
      c: { items: [5], nextCursor: undefined },
    };
    const seen: (string | undefined)[] = [];
    const all = await collectPages<number>(async (cursor) => {
      seen.push(cursor);
      return pages[cursor ?? '__start']!;
    });
    expect(all).toEqual([1, 2, 3, 4, 5]);
    expect(seen).toEqual([undefined, 'b', 'c']); // first call has no cursor
  });

  it('stops and truncates at maxItems', async () => {
    const all = await collectPages<number>(
      async (cursor) => {
        const n = cursor ? Number(cursor) : 0;
        return { items: [n, n + 1], nextCursor: String(n + 2) };
      },
      { maxItems: 5 },
    );
    expect(all).toHaveLength(5);
  });

  it('stops at maxPages even if the provider keeps returning a cursor (runaway backstop)', async () => {
    let calls = 0;
    const all = await collectPages<number>(
      async () => {
        calls++;
        return { items: [calls], nextCursor: 'always' }; // never ends
      },
      { maxPages: 3 },
    );
    expect(calls).toBe(3);
    expect(all).toEqual([1, 2, 3]);
  });

  it('handles a single page (no cursor)', async () => {
    const all = await collectPages<string>(async () => ({ items: ['only'] }));
    expect(all).toEqual(['only']);
  });
});
