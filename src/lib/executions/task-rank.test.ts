import { describe, it, expect } from 'vitest';
import {
  DueBand,
  compareTasks,
  dueBand,
  dueLabel,
  jiraPriority,
  linearPriority,
  parseDue,
  sortTasks,
  todoistPriority,
} from './task-rank';

// Local noon, so a date-only value parsed as local midnight lands on the same
// calendar day regardless of the machine's timezone.
const NOW = new Date(2026, 6, 28, 12, 0, 0);

describe('parseDue', () => {
  it('reads a date-only value as LOCAL midnight, not UTC', () => {
    const d = parseDue('2026-07-28')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(28);
    expect(d.getHours()).toBe(0);
  });

  it('returns null for empty or unparseable input', () => {
    expect(parseDue(null)).toBeNull();
    expect(parseDue('')).toBeNull();
    expect(parseDue('   ')).toBeNull();
    expect(parseDue('not a date')).toBeNull();
  });
});

describe('dueBand', () => {
  it('buckets by calendar day, not elapsed hours', () => {
    expect(dueBand('2026-07-27', NOW)).toBe(DueBand.Overdue);
    expect(dueBand('2026-07-28', NOW)).toBe(DueBand.Today);
    expect(dueBand('2026-07-29', NOW)).toBe(DueBand.Soon);
    expect(dueBand('2026-08-04', NOW)).toBe(DueBand.Soon);
    expect(dueBand('2026-08-05', NOW)).toBe(DueBand.Later);
    expect(dueBand(null, NOW)).toBe(DueBand.None);
  });

  it('treats earlier-today as Today, not Overdue', () => {
    // A task due at 9am is still today's problem at noon.
    expect(dueBand('2026-07-28T09:00:00', NOW)).toBe(DueBand.Today);
  });
});

describe('compareTasks', () => {
  const sorted = (tasks: { id: string; due?: string | null; priority?: number | null }[]) =>
    sortTasks(tasks, NOW).map((t) => t.id);

  it('orders overdue before today before soon before undated', () => {
    expect(
      sorted([
        { id: 'none' },
        { id: 'soon', due: '2026-07-30' },
        { id: 'overdue', due: '2026-07-20' },
        { id: 'today', due: '2026-07-28' },
        { id: 'later', due: '2026-09-01' },
      ]),
    ).toEqual(['overdue', 'today', 'soon', 'later', 'none']);
  });

  it('puts a low-priority task due today above an urgent one due next month', () => {
    expect(
      sorted([
        { id: 'urgent-later', due: '2026-09-01', priority: 1 },
        { id: 'calm-today', due: '2026-07-28', priority: 0 },
      ]),
    ).toEqual(['calm-today', 'urgent-later']);
  });

  it('breaks ties within a band by priority', () => {
    expect(
      sorted([
        { id: 'low', due: '2026-07-28', priority: 0.1 },
        { id: 'high', due: '2026-07-28', priority: 0.9 },
      ]),
    ).toEqual(['high', 'low']);
  });

  it('ranks a task with any priority above one with none, all else equal', () => {
    expect(sorted([{ id: 'unset' }, { id: 'set', priority: 0 }])).toEqual(['set', 'unset']);
  });

  it('is stable, preserving the source order for equivalent rows', () => {
    // This is what keeps the deck's curated ordering intact for undated tasks
    // instead of scrambling a list the user already arranged.
    expect(sorted([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('orders earlier due dates first inside the same band', () => {
    expect(
      sorted([
        { id: 'fri', due: '2026-07-31' },
        { id: 'wed', due: '2026-07-29' },
      ]),
    ).toEqual(['wed', 'fri']);
  });

  it('does not mutate the input array', () => {
    const input = [{ id: 'b', due: '2026-09-01' }, { id: 'a', due: '2026-07-20' }];
    sortTasks(input, NOW);
    expect(input.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('dueLabel', () => {
  it('names the near cases and dates the far ones', () => {
    expect(dueLabel('2026-07-28', NOW)).toBe('Today');
    expect(dueLabel('2026-07-29', NOW)).toBe('Tomorrow');
    expect(dueLabel('2026-07-27', NOW)).toBe('Yesterday');
    expect(dueLabel('2026-07-24', NOW)).toBe('4 days overdue');
    expect(dueLabel(null, NOW)).toBeNull();
  });
});

describe('priority normalization', () => {
  it('maps Todoist 1..4 upward', () => {
    expect(todoistPriority(1)).toBe(0);
    expect(todoistPriority(4)).toBe(1);
    expect(todoistPriority(0)).toBeNull();
    expect(todoistPriority('4')).toBeNull();
  });

  it('maps Linear 1..4 downward — its scale is inverted', () => {
    expect(linearPriority(1)).toBe(1);
    expect(linearPriority(4)).toBe(0);
    // 0 means "no priority set" in Linear, which is not the same as lowest.
    expect(linearPriority(0)).toBeNull();
  });

  it('maps Jira names, and scores renamed schemes as unknown', () => {
    expect(jiraPriority('Highest')).toBe(1);
    expect(jiraPriority('medium')).toBe(0.5);
    expect(jiraPriority('Blocker')).toBeNull();
    expect(jiraPriority(2)).toBeNull();
  });
});
