import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateTaskListsSoon, isTaskDetailKey } from './invalidate-tasks';

afterEach(() => {
  vi.useRealTimers();
});

describe('invalidateTaskListsSoon', () => {
  it('tells a single task from lists, counts and badges by its key', () => {
    expect(isTaskDetailKey(['tasks', 't1'])).toBe(true);
    expect(isTaskDetailKey(['tasks', { status: 'todo' }])).toBe(false);
    expect(isTaskDetailKey(['tasks', undefined])).toBe(false);
    expect(isTaskDetailKey(['tasks', 'attention', 't1,t2'])).toBe(false);
    expect(isTaskDetailKey(['notes', 'n1'])).toBe(false);
  });

  it('refreshes lists and badges once per burst, never an open task', () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const list = ['tasks', { status: 'in_progress', orderBy: 'sortKey' }];
    const attention = ['tasks', 'attention', 't1'];
    const detail = ['tasks', 't1'];
    const other = ['sessions', 'rail'];
    for (const key of [list, attention, detail, other]) qc.setQueryData(key, {});
    const spy = vi.spyOn(qc, 'invalidateQueries');

    invalidateTaskListsSoon(qc);
    invalidateTaskListsSoon(qc);
    invalidateTaskListsSoon(qc);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(spy).toHaveBeenCalledTimes(1);

    const stale = (key: unknown[]) => qc.getQueryState(key)?.isInvalidated;
    expect(stale(list)).toBe(true);
    expect(stale(attention)).toBe(true);
    expect(stale(detail)).toBe(false);
    expect(stale(other)).toBe(false);

    // The next burst schedules again.
    invalidateTaskListsSoon(qc);
    vi.advanceTimersByTime(1_000);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
