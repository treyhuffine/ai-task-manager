import { describe, expect, it } from 'vitest';
import { selectPinnedSessions } from './session-sort';

type Row = {
  id: string;
  status: string;
  execution: { pinnedAt: string | null } | null;
};

const row = (id: string, status: string, pinnedAt: string | null): Row => ({
  id,
  status,
  execution: pinnedAt === null && status === 'noexec' ? null : { pinnedAt },
});

describe('selectPinnedSessions', () => {
  it('keeps only active, pinned executions', () => {
    const rows: Row[] = [
      row('a', 'active', '2026-08-01T00:00:00Z'),
      row('b', 'active', null), // active but not pinned
      row('c', 'archived', '2026-08-01T00:00:00Z'), // pinned but archived (stale) — excluded
      { id: 'd', status: 'active', execution: null }, // no execution — excluded
    ];
    expect(selectPinnedSessions(rows).map((r) => r.id)).toEqual(['a']);
  });

  it('orders most-recently-pinned first', () => {
    const rows: Row[] = [
      row('old', 'active', '2026-08-01T00:00:00Z'),
      row('new', 'active', '2026-08-25T12:00:00Z'),
      row('mid', 'active', '2026-08-10T00:00:00Z'),
    ];
    expect(selectPinnedSessions(rows).map((r) => r.id)).toEqual(['new', 'mid', 'old']);
  });

  it('tie-breaks equal pin times by id (stable, deterministic)', () => {
    const t = '2026-08-25T12:00:00Z';
    const rows: Row[] = [row('a', 'active', t), row('c', 'active', t), row('b', 'active', t)];
    // Same pinnedAt → descending id, so ordering never flickers between renders.
    expect(selectPinnedSessions(rows).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('does not mutate the input array', () => {
    const rows: Row[] = [
      row('old', 'active', '2026-08-01T00:00:00Z'),
      row('new', 'active', '2026-08-25T12:00:00Z'),
    ];
    const before = rows.map((r) => r.id);
    selectPinnedSessions(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it('returns empty when nothing is pinned', () => {
    expect(selectPinnedSessions([row('a', 'active', null)])).toEqual([]);
  });
});
