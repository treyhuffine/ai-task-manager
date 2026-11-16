import { describe, expect, it } from 'vitest';
import { isClientReadyTodo } from './client-ready';

const NOW = Date.parse('2026-09-10T12:00:00Z');
const past = new Date(NOW - 60_000).toISOString();
const future = new Date(NOW + 60_000).toISOString();

describe('isClientReadyTodo', () => {
  it('a freshly created todo task is Ready immediately', () => {
    // This underwrites the "create a task from the Deck and see it right away"
    // flow: a brand-new task (status todo, no blocker/resurface/recurrence)
    // must pass the Deck's Ready gate the instant it exists.
    expect(isClientReadyTodo({ status: 'todo' }, NOW)).toBe(true);
  });

  it('non-todo lifecycle states are not Ready', () => {
    for (const status of ['consider', 'in_progress', 'done', 'archived']) {
      expect(isClientReadyTodo({ status }, NOW)).toBe(false);
    }
  });

  it('a blocked task is not Ready', () => {
    expect(isClientReadyTodo({ status: 'todo', blockedOn: 'task-x' }, NOW)).toBe(false);
  });

  it('honours a resurfaceAfter deferral', () => {
    expect(isClientReadyTodo({ status: 'todo', resurfaceAfter: future }, NOW)).toBe(false);
    expect(isClientReadyTodo({ status: 'todo', resurfaceAfter: past }, NOW)).toBe(true);
  });

  it('hides a future recurrence but shows a due one, by local calendar day', () => {
    // A next occurrence is a calendar date, due from the start of its local day.
    const evening = new Date(2026, 8, 10, 21, 30).getTime();
    expect(isClientReadyTodo({ status: 'todo', recurrence: 'FREQ=DAILY', nextRecurrenceAt: '2026-09-11' }, evening)).toBe(false);
    expect(isClientReadyTodo({ status: 'todo', recurrence: 'FREQ=DAILY', nextRecurrenceAt: '2026-09-10' }, evening)).toBe(true);
    expect(isClientReadyTodo({ status: 'todo', recurrence: 'FREQ=DAILY', nextRecurrenceAt: '2026-09-11' }, new Date(2026, 8, 11, 0, 5).getTime())).toBe(true);
    // A next date without a repeat holds nothing back.
    expect(isClientReadyTodo({ status: 'todo', recurrence: null, nextRecurrenceAt: '2026-09-11' }, evening)).toBe(true);
  });
});
