import { describe, expect, it } from 'vitest';
import {
  hasRuntimeActivity,
  withBackgroundTaskStatus,
  withRunningStatus,
} from './runtime-status';

describe('session runtime status merging', () => {
  it('preserves background work when root runtime changes', () => {
    expect(withRunningStatus({
      running: false,
      backgroundTasks: true,
      backgroundTaskIds: ['child-1'],
    }, true)).toEqual({
      running: true,
      backgroundTasks: true,
      backgroundTaskIds: ['child-1'],
    });
  });

  it('preserves root runtime when background membership changes', () => {
    expect(withBackgroundTaskStatus({
      running: true,
      backgroundTasks: false,
      backgroundTaskIds: [],
    }, true, ['child-1'])).toEqual({
      running: true,
      backgroundTasks: true,
      backgroundTaskIds: ['child-1'],
    });
  });

  it('defaults only the missing axis for an empty cache', () => {
    expect(withRunningStatus(undefined, true)).toEqual({
      running: true,
      backgroundTasks: false,
      backgroundTaskIds: [],
    });
    expect(withBackgroundTaskStatus(undefined, true, ['child-1'])).toEqual({
      running: false,
      backgroundTasks: true,
      backgroundTaskIds: ['child-1'],
    });
  });

  it('replaces task membership while preserving the background axis', () => {
    expect(withBackgroundTaskStatus({
      running: false,
      backgroundTasks: true,
      backgroundTaskIds: ['stale', 'child-1'],
    }, true, ['child-1', 'child-2'])).toEqual({
      running: false,
      backgroundTasks: true,
      backgroundTaskIds: ['child-1', 'child-2'],
    });
    expect(withBackgroundTaskStatus({
      running: false,
      backgroundTasks: true,
      backgroundTaskIds: ['child-1'],
    }, false, ['child-1'])).toEqual({
      running: false,
      backgroundTasks: false,
      backgroundTaskIds: [],
    });
  });

  it('keeps data surfaces busy until both root and background work end', () => {
    expect(hasRuntimeActivity({
      running: true,
      backgroundTasks: false,
      backgroundTaskIds: [],
    })).toBe(true);
    expect(hasRuntimeActivity({
      running: false,
      backgroundTasks: true,
      backgroundTaskIds: ['child-1'],
    })).toBe(true);
    expect(hasRuntimeActivity({
      running: false,
      backgroundTasks: false,
      backgroundTaskIds: [],
    })).toBe(false);
    expect(hasRuntimeActivity(undefined)).toBe(false);
  });
});
