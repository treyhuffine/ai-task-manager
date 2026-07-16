import { describe, expect, it } from 'vitest';
import type { BackgroundTask } from '@/hooks/use-background-tasks';
import { selectVisibleBackgroundTasks } from './background-task-visibility';

function task(taskId: string, isActive: boolean): BackgroundTask {
  return {
    taskId,
    status: isActive ? 'running' : 'completed',
    updatedAt: '2026-07-15T00:00:00.000Z',
    isActive,
  };
}

describe('selectVisibleBackgroundTasks', () => {
  const active = task('active', true);
  const completed = task('completed', false);

  it('keeps transcript-derived active tasks while runtime status is loading', () => {
    expect(selectVisibleBackgroundTasks([active, completed], undefined, undefined)).toEqual([
      active,
      completed,
    ]);
  });

  it('keeps active tasks when runtime status confirms background work', () => {
    expect(selectVisibleBackgroundTasks([active, completed], true, ['active'])).toEqual([
      active,
      completed,
    ]);
  });

  it('suppresses stale active tasks but preserves completed outcomes', () => {
    expect(selectVisibleBackgroundTasks([active, completed], false, [])).toEqual([completed]);
  });

  it('does not resurrect a stale task when a different task becomes active', () => {
    const stale = task('stale-before-restart', true);
    const current = task('current-after-restart', true);

    expect(selectVisibleBackgroundTasks(
      [stale, current, completed],
      true,
      ['current-after-restart'],
    )).toEqual([current, completed]);
  });

  it('fails closed when an active runtime snapshot omits task membership', () => {
    expect(selectVisibleBackgroundTasks([active, completed], true, undefined)).toEqual([completed]);
  });
});
