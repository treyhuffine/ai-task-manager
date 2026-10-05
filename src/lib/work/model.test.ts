import { describe, expect, it } from 'vitest';
import {
  BLOCK_GAP_MS,
  BUSY_GAP_MS,
  MINUTE,
  MIN_BLOCK_MS,
  buildRange,
  commitEffortHours,
  countWords,
  effortLines,
  extendBlocks,
  localDayStart,
  mergeIntervals,
  overlapMs,
  peakConcurrency,
  sittings,
  unionMs,
  type CommitInput,
  type LedgerBlock,
  type SessionMeta,
  type WorkEvent,
} from './model';

const T0 = localDayStart('2026-09-28') + 9 * 60 * MINUTE; // Mon 9:00 local
const at = (minutes: number) => T0 + minutes * MINUTE;
const ev = (sessionId: string, minutes: number, source = 'agent', extra: Partial<WorkEvent> = {}): WorkEvent => ({
  sessionId,
  at: at(minutes),
  source,
  fromOtherChat: false,
  words: 0,
  ...extra,
});

describe('extendBlocks', () => {
  it('cuts a chat into blocks where 30 minutes pass quietly', () => {
    const blocks = extendBlocks([], [ev('a', 0, 'user'), ev('a', 5), ev('a', 20), ev('a', 60), ev('a', 70)])!;
    expect(blocks.map((b) => [b.start, b.end])).toEqual([
      [at(0), at(20)],
      [at(60), at(70)],
    ]);
  });

  it('counts agent time only across steps of 10 minutes or less', () => {
    // 0 → 5 (5m) → 25 (20m gap, waiting) → 29 (4m).
    const [block] = extendBlocks([], [ev('a', 0), ev('a', 5), ev('a', 25), ev('a', 29)])!;
    expect(block!.busyMs).toBe(9 * MINUTE);
    expect(BUSY_GAP_MS).toBe(10 * MINUTE);
  });

  it('records your messages and words, not messages from other chats', () => {
    const [block] = extendBlocks([], [
      ev('a', 0, 'user', { words: 7 }),
      ev('a', 1, 'agent', { words: 40 }),
      ev('a', 2, 'user', { fromOtherChat: true, words: 99 }),
    ])!;
    expect(block!.touches).toEqual([at(0)]);
    expect(block!.yourWords).toBe(7);
    expect(block!.agentWords).toBe(40);
  });

  it('extending in steps matches building at once', () => {
    const events = [0, 3, 9, 15, 50, 52, 120, 125].map((m, i) => ev('a', m, i % 3 === 0 ? 'user' : 'agent', { words: i }));
    const once = extendBlocks([], events)!;
    const stepped = extendBlocks(extendBlocks([], events.slice(0, 5))!, events.slice(5))!;
    expect(stepped).toEqual(once);
  });

  it('asks for a rebuild when older history arrives', () => {
    const blocks = extendBlocks([], [ev('a', 200)])!;
    expect(extendBlocks(blocks, [ev('a', 0)])).toBeNull();
    // Slightly earlier than the block (within a gap) just stretches it.
    expect(extendBlocks(blocks, [ev('a', 190)])![0]!.start).toBe(at(190));
  });
});

describe('interval math', () => {
  it('merges, unions and overlaps', () => {
    expect(mergeIntervals([[5, 10], [0, 6], [20, 30]])).toEqual([[0, 10], [20, 30]]);
    expect(mergeIntervals([[0, 10], [15, 20]], 5)).toEqual([[0, 20]]);
    expect(unionMs([[0, 10], [5, 15], [20, 25]])).toBe(20);
    expect(overlapMs([[0, 10], [20, 30]], [[5, 25]])).toBe(10);
  });

  it('turns your messages into sittings of at least 5 minutes', () => {
    expect(sittings([at(0), at(10), at(100)])).toEqual([
      [at(0), at(10)],
      [at(100), at(100) + MIN_BLOCK_MS],
    ]);
    expect(BLOCK_GAP_MS).toBe(30 * MINUTE);
  });

  it('finds the peak, with touching ends not overlapping', () => {
    expect(peakConcurrency([[0, 10], [10, 20]])).toEqual({ count: 1, at: 0 });
    expect(peakConcurrency([[0, 10], [5, 20], [6, 8]])).toEqual({ count: 3, at: 6 });
    expect(peakConcurrency([])).toBeNull();
  });
});

describe('commit sizing', () => {
  it('leaves out generated, lock and data files, caps a file, discounts deletions', () => {
    expect(
      effortLines([
        { path: 'src/a.ts', added: 100, deleted: 40 },
        { path: 'pnpm-lock.yaml', added: 5000, deleted: 0 },
        { path: 'public/logo.svg', added: 300, deleted: 0 },
        { path: 'data/prices.json', added: 900, deleted: 0 },
        { path: 'src/huge.ts', added: 5000, deleted: 0 },
      ]),
    ).toBe(110 + 800);
  });

  it('sizes in bands', () => {
    expect([5, 50, 200, 800, 5000].map(commitEffortHours)).toEqual([0.5, 2, 6, 14, 24]);
  });

  it('counts words', () => {
    expect(countWords('  ship   it now ')).toBe(3);
    expect(countWords(null)).toBe(0);
  });
});

describe('buildRange', () => {
  const sessions = new Map<string, SessionMeta>([
    ['exec-1', { id: 'exec-1', agentId: 'ri-app', executionId: 'x1', label: 'Rail rework', scheduled: false }],
    ['exec-2', { id: 'exec-2', agentId: 'ri-app', executionId: 'x2', label: 'Calendar', scheduled: false }],
    ['run-1', { id: 'run-1', agentId: 'blog', executionId: null, label: 'Nightly digest', scheduled: true }],
  ]);
  const block = (sessionId: string, start: number, end: number, extra: Partial<LedgerBlock> = {}): LedgerBlock => ({
    sessionId,
    start: at(start),
    end: at(end),
    busyMs: (end - start) * MINUTE,
    touches: [],
    yourWords: 0,
    agentWords: 0,
    ...extra,
  });
  const commit = (minutes: number, effortHours: number, agentIds = ['ri-app']): CommitInput => ({
    hash: `h${minutes}`,
    at: new Date(at(minutes)).toISOString(),
    subject: `feat: thing ${minutes}`,
    lines: 100,
    effortHours,
    agentIds,
  });

  const range = buildRange({
    start: '2026-09-28',
    days: 2,
    now: at(48 * 60),
    blocks: [
      block('exec-1', 0, 60, { touches: [at(0), at(20)], agentWords: 1000 }),
      block('exec-2', 30, 90),
      block('run-1', 120, 150),
    ],
    sessions,
    agents: [
      { id: 'ri-app', name: 'ai-task-manager', emoji: null },
      { id: 'blog', name: 'Blogging', emoji: null },
    ],
    commits: [commit(45, 6), commit(80, 2), commit(600, 0.5)],
    tasksDone: [{ id: 't1', title: 'Ship it', at: new Date(at(100)).toISOString() }],
    executionsFinished: [],
  });
  const monday = range.dayList[0]!;

  it('merges an agent\'s parallel chats into one span and attaches commits', () => {
    const app = monday.spans.filter((s) => s.agentId === 'ri-app');
    expect(app).toHaveLength(1);
    expect(app[0]!.chats.map((c) => c.label)).toEqual(['Rail rework', 'Calendar']);
    expect(app[0]!.commits.map((c) => c.hash)).toEqual(['h45', 'h80']);
    // Commits size the span, not its agent time.
    expect(app[0]!.personHours).toBe(8);
  });

  it('counts agent time one for one where nothing was committed', () => {
    const blog = monday.spans.find((s) => s.agentId === 'blog')!;
    expect(blog.personHours).toBe(0.5);
    expect(blog.chats[0]!.scheduled).toBe(true);
  });

  it('keeps a commit no span covers', () => {
    expect(monday.looseCommits.map((c) => c.hash)).toEqual(['h600']);
  });

  it('adds up the day', () => {
    const s = monday.stats;
    expect(s.agentMinutes).toBe(60 + 60 + 30);
    expect(s.handsOnMinutes).toBe(20);
    // You sat 9:00 to 9:20 (exec-1). Everything else ran without you:
    // exec-1's other 40m, exec-2's 60m less the 0m it shared, and the run.
    expect(s.whileAwayMinutes).toBe(40 + 60 + 30);
    expect(s.activeMinutes).toBe(90 + 30);
    expect(s.commits).toBe(3);
    expect(s.personHours).toBe(8 + 0.5 + 0.5);
    expect(s.codeHours).toBe(8.5);
    expect(s.peak).toEqual({ count: 2, at: new Date(at(30)).toISOString() });
    expect(s.agentWords).toBe(1000);
    expect(monday.tasksDone).toHaveLength(1);
  });

  it('totals across days and ranks agents', () => {
    expect(range.totals.commits).toBe(3);
    expect(range.totals.chats).toBe(3);
    expect(range.agents[0]!.name).toBe('ai-task-manager');
    expect(range.dayList[1]!.spans).toEqual([]);
  });

  it('never draws work after now', () => {
    const early = buildRange({
      start: '2026-09-28',
      days: 1,
      now: at(40),
      blocks: [block('exec-1', 0, 60)],
      sessions,
      agents: [],
      commits: [],
      tasksDone: [],
      executionsFinished: [],
    });
    expect(Date.parse(early.dayList[0]!.spans[0]!.end)).toBe(at(40));
  });
});
