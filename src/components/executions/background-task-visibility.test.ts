import { describe, expect, it } from 'vitest';
import type { BackgroundTask } from '@/hooks/use-background-tasks';
import { selectVisibleBackgroundTasks, missingLiveTaskIds, mergeEventLists, withLivePlaceholders } from './background-task-visibility';

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

describe('long-lived tasks that started before the loaded page', () => {
  const t = (taskId: string, isActive = true): BackgroundTask => ({
    taskId,
    status: isActive ? 'running' : 'completed',
    updatedAt: '2026-09-24T21:45:29.000Z',
    isActive,
  });

  it('names the live ids the loaded events do not describe, sorted', () => {
    expect(missingLiveTaskIds([t('b')], true, ['c', 'b', 'a', 'a'])).toEqual(['a', 'c']);
  });

  it('asks for nothing while the runtime is unknown or idle', () => {
    expect(missingLiveTaskIds([], undefined, undefined)).toEqual([]);
    expect(missingLiveTaskIds([], false, ['a'])).toEqual([]);
    expect(missingLiveTaskIds([t('a')], true, ['a'])).toEqual([]);
  });

  it('merges fetched events without duplicates, oldest first', () => {
    const e = (id: string, createdAt: string) => ({ id, createdAt });
    const base = [e('3', '2026-01-01T00:00:03Z'), e('4', '2026-01-01T00:00:04Z')];
    const extra = [e('1', '2026-01-01T00:00:01Z'), e('3', '2026-01-01T00:00:03Z')];
    expect(mergeEventLists(base, extra).map((x) => x.id)).toEqual(['1', '3', '4']);
    expect(mergeEventLists(base, [])).toBe(base);
  });

  it('never hides live work: an undescribable live task still shows, unnamed', () => {
    const shown = withLivePlaceholders([t('known')], true, ['known', 'ghost']);
    expect(shown.map((x) => [x.taskId, x.isActive, x.description])).toEqual([
      ['known', true, undefined],
      ['ghost', true, undefined],
    ]);
    expect(withLivePlaceholders([t('known')], false, [])).toEqual([t('known')]);
  });
});
