import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('./client', () => ({ api: { post: (...args: unknown[]) => post(...args) } }));

const { fetchDiffStatsBatched } = await import('./diff-stats-batch');

/** Resolve a batch request with `+n` additions for each requested id. */
function respondWithAdditions() {
  post.mockImplementation(async (_path: string, body: { ids: string[] }) => ({
    stats: Object.fromEntries(
      body.ids.map((id) => [id, { files: 1, additions: id.length, deletions: 0 }]),
    ),
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  post.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Let the debounce window elapse and the mocked request settle. */
async function settle() {
  await vi.advanceTimersByTimeAsync(50);
}

describe('fetchDiffStatsBatched', () => {
  it('collapses concurrent per-row calls into one request', async () => {
    respondWithAdditions();
    const rows = ['aa', 'bbb', 'cccc'].map(fetchDiffStatsBatched);
    await settle();

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![1]).toEqual({ ids: ['aa', 'bbb', 'cccc'] });
    expect(await Promise.all(rows)).toEqual([
      { files: 1, additions: 2, deletions: 0 },
      { files: 1, additions: 3, deletions: 0 },
      { files: 1, additions: 4, deletions: 0 },
    ]);
  });

  it('asks for a duplicated id once but answers every caller', async () => {
    respondWithAdditions();
    const a = fetchDiffStatsBatched('same');
    const b = fetchDiffStatsBatched('same');
    await settle();

    expect(post.mock.calls[0]![1]).toEqual({ ids: ['same'] });
    expect(await a).toEqual({ files: 1, additions: 4, deletions: 0 });
    expect(await b).toEqual({ files: 1, additions: 4, deletions: 0 });
  });

  it('splits a long list into parallel chunks so early rows paint first', async () => {
    respondWithAdditions();
    const ids = Array.from({ length: 60 }, (_, i) => `id-${i}`);
    const rows = ids.map(fetchDiffStatsBatched);
    await settle();

    // 60 ids at a chunk size of 25 → 3 requests, not 60 and not 1.
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls.map((c) => (c[1] as { ids: string[] }).ids.length)).toEqual([25, 25, 10]);
    // Chunks are issued together rather than awaited in sequence.
    expect((await Promise.all(rows)).every((r) => r !== null)).toBe(true);
  });

  it('treats an id the server omitted as no stats', async () => {
    post.mockResolvedValue({ stats: {} });
    const row = fetchDiffStatsBatched('ghost');
    await settle();
    expect(await row).toBeNull();
  });

  it('rejects only the callers whose chunk failed', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `id-${i}`);
    post.mockImplementation(async (_path: string, body: { ids: string[] }) => {
      if (body.ids.includes('id-0')) throw new Error('boom');
      return {
        stats: Object.fromEntries(body.ids.map((id) => [id, { files: 1, additions: 1, deletions: 0 }])),
      };
    });
    const rows = ids.map(fetchDiffStatsBatched);
    const settled = Promise.allSettled(rows);
    await settle();

    const results = await settled;
    expect(results.slice(0, 25).every((r) => r.status === 'rejected')).toBe(true);
    expect(results.slice(25).every((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('starts a fresh window after a flush', async () => {
    respondWithAdditions();
    void fetchDiffStatsBatched('first');
    await settle();
    void fetchDiffStatsBatched('second');
    await settle();

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]![1]).toEqual({ ids: ['second'] });
  });
});
