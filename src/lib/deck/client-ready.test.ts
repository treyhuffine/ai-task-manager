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

  it('hides a future recurrence but shows a due one', () => {
    expect(isClientReadyTodo({ status: 'todo', recurrence: 'FREQ=DAILY', nextRecurrenceAt: future }, NOW)).toBe(false);
    expect(isClientReadyTodo({ status: 'todo', recurrence: 'FREQ=DAILY', nextRecurrenceAt: past }, NOW)).toBe(true);
  });
});
