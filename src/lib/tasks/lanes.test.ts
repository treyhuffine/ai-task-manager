import { describe, it, expect } from 'vitest';
import { TASK_LANES, KANBAN_COLUMNS, laneStatus, laneForStatus, columnDropCommand } from './lanes';
import { TASK_STATUSES } from './lifecycle';

describe('lanes', () => {
  it('maps every lane to a canonical status and back', () => {
    for (const lane of TASK_LANES) {
      expect(TASK_STATUSES).toContain(lane.status);
      expect(laneStatus(lane.key)).toBe(lane.status);
      expect(laneForStatus(lane.status)).toBe(lane.key);
    }
  });

  it('Kanban board columns are Consider, Todo, In progress, Done (Archived via history)', () => {
    expect(KANBAN_COLUMNS).toEqual(['consider', 'todo', 'current', 'done']);
    expect(KANBAN_COLUMNS).not.toContain('archived');
  });
});

describe('columnDropCommand (cross-column drops -> semantic commands)', () => {
  it('same column is a reorder, not a transition', () => {
    for (const s of TASK_STATUSES) expect(columnDropCommand(s, s)).toBeNull();
  });

  it('into In progress starts committed/possible work, rejects terminal', () => {
    expect(columnDropCommand('consider', 'in_progress')).toBe('start');
    expect(columnDropCommand('todo', 'in_progress')).toBe('start');
    expect(columnDropCommand('done', 'in_progress')).toBeNull();
    expect(columnDropCommand('archived', 'in_progress')).toBeNull();
  });

  it('into Todo commits / returns / reopens / restores by source', () => {
    expect(columnDropCommand('consider', 'todo')).toBe('move_to_todo');
    expect(columnDropCommand('in_progress', 'todo')).toBe('return_to_todo');
    expect(columnDropCommand('done', 'todo')).toBe('reopen');
    expect(columnDropCommand('archived', 'todo')).toBe('restore');
  });

  it('into Consider only from Todo (uncommit); rejects from in_progress/terminal', () => {
    expect(columnDropCommand('todo', 'consider')).toBe('move_to_consider');
    expect(columnDropCommand('in_progress', 'consider')).toBeNull();
    expect(columnDropCommand('done', 'consider')).toBeNull();
  });

  it('into Done completes committed/underway work, rejects consider/archived', () => {
    expect(columnDropCommand('todo', 'done')).toBe('complete');
    expect(columnDropCommand('in_progress', 'done')).toBe('complete');
    expect(columnDropCommand('consider', 'done')).toBeNull();
    expect(columnDropCommand('archived', 'done')).toBeNull();
  });
});
