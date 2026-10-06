import { describe, expect, it } from 'vitest';
import {
  formatSpan,
  formatTimes,
  leverageChain,
  workTiles,
  weeklyReport,
  bookEquivalent,
  formatDuration,
  formatHours,
  leverageLine,
  personHoursLine,
  speedLine,
  summaryLines,
  textureLine,
  wordsLine,
} from './equivalents';
import type { WorkStats } from './types';

const stats = (over: Partial<WorkStats> = {}): WorkStats => ({
  handsOnMinutes: 41.5 * 60,
  agentMinutes: 162 * 60,
  whileAwayMinutes: 38 * 60,
  activeMinutes: 74 * 60,
  personHours: 2377,
  codeHours: 2200,
  codeAgentMinutes: 140 * 60,
  commits: 256,
  agents: 10,
  chats: 116,
  agentWords: 451_506,
  yourWords: 39_255,
  peak: { count: 9, at: '2026-10-01T21:14:00.000Z' },
  ...over,
});

describe('equivalents', () => {
  it('says person-hours as a team for the week and people for a year', () => {
    expect(personHoursLine(stats(), 7)).toBe('About 2,377 person-hours of work: a team of 59 for a week, or 1.2 people for a year.');
    expect(personHoursLine(stats({ personHours: 30 }), 1)).toBe('About 30 person-hours of work: a team of 4 for a day.');
    expect(personHoursLine(stats({ personHours: 0.2 }), 1)).toBeNull();
    // Under a person-year, months read better than a fraction of a person.
    expect(personHoursLine(stats({ personHours: 676 }), 1)).toBe('About 676 person-hours of work: a team of 85 for a day, or a person for 4 months.');
  });

  it('says what each of your hours became', () => {
    expect(leverageLine(stats())).toBe('You were hands-on 41h 30m. Agents ran 162h. Each hour of yours became 57 hours of work.');
    expect(leverageLine(stats({ handsOnMinutes: 0 }))).toBe('You stayed out of it. Agents ran 162h.');
  });

  it('compares words to the closest book', () => {
    expect(bookEquivalent(451_506)).toBe('about the length of The Lord of the Rings');
    expect(bookEquivalent(39_255)).toBe('most of The Great Gatsby');
    expect(bookEquivalent(150_000)).toBe('about the length of Pride and Prejudice');
    expect(bookEquivalent(5_000_000)).toBe('5 times the whole Harry Potter series');
    expect(bookEquivalent(5_000)).toBeNull();
    expect(wordsLine(stats())).toBe(
      'Agents wrote 452k words, about the length of The Lord of the Rings. Typing that at 40 words a minute would take 188 hours.',
    );
  });

  it('notes the texture and speed', () => {
    expect(textureLine(stats())).toMatch(/^38h while you were away · 9 at once at the peak, .+ · 256 commits across 10 agents$/);
    expect(speedLine(stats())).toBe('On code, agents worked about 16× faster than a person would.');
    expect(speedLine(stats({ codeHours: 2 }))).toBeNull();
  });

  it('keeps UI copy free of long dashes and semicolons', () => {
    for (const line of summaryLines(stats(), 7)) {
      expect(line).not.toMatch(/[—–;]/);
    }
  });

  it('formats', () => {
    expect([formatDuration(45), formatDuration(60), formatDuration(150)]).toEqual(['45m', '1h', '2h 30m']);
    expect([formatHours(0.5), formatHours(2.25), formatHours(57.4), formatHours(2377.2)]).toEqual(['0.5', '2.3', '57', '2,377']);
  });
});

describe('weeklyReport', () => {
  const range = (over: Partial<WorkStats>, finished = 0, subjects: string[] = []) => ({
    start: '2026-09-28',
    days: 7,
    totals: stats(over),
    agents: [{ id: 'a', name: 'ai-task-manager', emoji: null, color: 0, agentMinutes: 51 * 60, personHours: 1000, commits: subjects.length }],
    dayList: [
      {
        date: '2026-09-28',
        spans: [],
        looseCommits: subjects.map((subject, i) => ({ hash: `h${i}`, at: '', subject, agentId: 'a', lines: 10, effortHours: 0.5 })),
        blocks: [],
        sittings: [],
        tasksDone: [],
        executionsFinished: Array.from({ length: finished }, (_, i) => ({ id: `x${i}`, label: 'x', agentId: 'a', at: '' })),
        stats: stats(over),
      },
    ],
  });

  it('says what shipped, where agent time went, and the leverage', () => {
    const [shipped, time, leverage] = weeklyReport(range({ agents: 13 }, 22, ['feat: a', 'fix: b', 'docs: c']));
    expect(shipped).toBe('Shipped 3 commits (1 feature, 1 fix) and finished 22 executions across 13 agents.');
    expect(time).toBe('Most agent time went to ai-task-manager: 51h of 162h (31%).');
    expect(leverage).toBe('About 2,377 person-hours of work from 41h 30m of yours, 57× your own time.');
  });

  it('reads right with no commits', () => {
    expect(weeklyReport(range({ agents: 2 }, 1))[0]).toBe('Finished 1 execution across 2 agents.');
  });
});

describe('leverageChain', () => {
  it('goes from your time to agent time to what a person would need', () => {
    const chain = leverageChain(stats())!;
    expect([formatSpan(chain.handsOnMinutes), formatSpan(chain.agentMinutes), formatHours(chain.personHours)]).toEqual(['42h', '162h', '2,377']);
    expect([chain.agentsPerHour, chain.personPerAgentHour, chain.leverage].map((x) => formatTimes(x!))).toEqual(['3.9×', '15×', '57×']);
    // The two steps multiply out to the leverage.
    expect(chain.agentsPerHour! * chain.personPerAgentHour!).toBeCloseTo(chain.leverage!);
  });

  it('leaves out a step it cannot measure', () => {
    const chain = leverageChain(stats({ handsOnMinutes: 0 }))!;
    expect([chain.agentsPerHour, chain.leverage]).toEqual([null, null]);
    expect(chain.personPerAgentHour).not.toBeNull();
    expect(leverageChain(stats({ agentMinutes: 0, personHours: 0 }))).toBeNull();
  });

  it('keeps short stretches to the minute', () => {
    expect([formatSpan(522), formatSpan(600), formatSpan(7441)]).toEqual(['8h 42m', '10h', '124h']);
  });
});

describe('workTiles', () => {
  it('reads as sentences: like a team of 59 for a week, like writing The Lord of the Rings', () => {
    const tiles = workTiles(stats(), 7, { weekday: true });
    expect(tiles.map((t) => [t.key, t.label, t.value])).toEqual([
      ['team', 'Like a team of', '59'],
      ['book', 'Like writing', 'The Lord of the Rings'],
      ['peak', 'Agents at once', '9'],
      ['commits', 'Commits', '256'],
    ]);
    expect(tiles[0]!.context).toEqual(['for a week', 'or 1.2 people for a year']);
    expect(tiles[1]!.context).toEqual(['452k words, 188 hours to type']);
    expect(tiles[3]!.context).toEqual(['Across 10 agents']);
  });

  it('names the book the way you would say it', () => {
    const book = (agentWords: number) => workTiles(stats({ agentWords }), 7).find((t) => t.key === 'book')?.value;
    expect([book(39_255), book(1_500_000), book(5_000_000), book(5_000)]).toEqual([
      'Most of The Great Gatsby',
      'The whole Harry Potter series',
      '5 times the whole Harry Potter series',
      undefined,
    ]);
    expect(book(1_100_000)).toBe('The whole Harry Potter series');
    expect(book(250_000)).toBe('Moby-Dick');
    expect(book(700_000)).toBe('War and Peace');
  });

  it('speaks in days for a day, and leaves out what has nothing to say', () => {
    const tiles = workTiles(stats({ personHours: 30, agentWords: 0, peak: null, commits: 0 }), 1);
    expect(tiles).toEqual([{ key: 'team', label: 'Like a team of', value: '4', context: ['for a day'] }]);
  });

  it('keeps tile copy free of long dashes and semicolons', () => {
    for (const t of workTiles(stats(), 7)) expect([t.label, t.value, ...t.context].join(' ')).not.toMatch(/[—–;]/);
  });
});
