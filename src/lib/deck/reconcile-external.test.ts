import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { DeckItem, CalendarBlock } from '@/db/types';

const TEST_DB = path.join(os.tmpdir(), `flow-deck-reconcile-test-${process.pid}.db`);
const DATE = '2026-06-18';

function rm() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

beforeEach(() => {
  rm();
  process.env.FLOW_DB_PATH = TEST_DB;
});

afterEach(async () => {
  const { setCalendarProvider } = await import('./calendar');
  setCalendarProvider(null);
});

afterAll(rm);

function items(n: number): DeckItem[] {
  return Array.from({ length: n }, (_, i) => ({
    taskId: `task-${i}`,
    rationale: 'r',
    continuityContext: null,
    source: 'ai' as const,
  }));
}

function block(startH: number, endH: number): CalendarBlock {
  const pad = (x: number) => String(x).padStart(2, '0');
  return { start: `${DATE}T${pad(startH)}:00:00`, end: `${DATE}T${pad(endH)}:00:00`, title: 'Meeting', source: 'test' };
}

async function setup() {
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
  return {
    q: await import('@/lib/db/queries'),
    cal: await import('./calendar'),
    rec: await import('./reconcile-external'),
  };
}

async function seedDeck(snapshot: CalendarBlock[] = []) {
  const { q } = await setup();
  return {
    q,
    deck: q.supersedeAndInsertDeck({
      forDate: DATE,
      items: items(5),
      alternatives: [],
      changes: [],
      origin: 'first_open',
      calendarSnapshot: snapshot,
    }),
  };
}

describe('reconcileDeckWithExternalChanges', () => {
  it('is a no-op when no calendar provider is registered', async () => {
    await seedDeck();
    const { rec } = await setup();
    const result = await rec.reconcileDeckWithExternalChanges({ date: DATE });
    expect(result.changed).toBe(false);
    expect(result.summary).toMatch(/no calendar/i);
  });

  it('does nothing when the calendar is unchanged', async () => {
    await seedDeck([]);
    const { rec, cal } = await setup();
    cal.setCalendarProvider(async () => []); // same as the empty snapshot
    const result = await rec.reconcileDeckWithExternalChanges({ date: DATE });
    expect(result.changed).toBe(false);
    expect(result.summary).toMatch(/no calendar changes/i);
  });

  it('bumps the lowest-priority items when a new meeting shrinks the day', async () => {
    await seedDeck([]); // deck assumed an open day
    const { rec, cal, q } = await setup();
    cal.setCalendarProvider(async () => [block(9, 17)]); // 8h booked → ~60m left
    const result = await rec.reconcileDeckWithExternalChanges({ date: DATE });

    expect(result.changed).toBe(true);
    expect(result.deck?.origin).toBe('midday');
    // 5 items × 30m = 150m needed; ~60m available → keep 2, bump 3.
    expect(result.deck?.items.length).toBe(2);
    const bumped = (result.deck?.changes ?? []).filter((c) => c.kind === 'bumped');
    expect(bumped.length).toBe(3);
    expect(bumped.every((c) => c.source === 'calendar')).toBe(true);
    expect(bumped.every((c) => c.channel != null)).toBe(true);

    // The active deck for today is now the reconciled version, full history kept.
    expect(q.getActiveDeckForDate(DATE)?.id).toBe(result.deck?.id);
    expect(q.getDeckVersions(DATE).length).toBe(2);
  });

  it('does not touch the deck when a meeting is removed and it still fits', async () => {
    await seedDeck([block(9, 17)]); // deck was built against a busy day
    const { rec, cal } = await setup();
    cal.setCalendarProvider(async () => []); // meeting cancelled → day is open again
    const result = await rec.reconcileDeckWithExternalChanges({ date: DATE });
    expect(result.changed).toBe(false);
    expect(result.summary).toMatch(/still fits/i);
  });
});
