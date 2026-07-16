import { beforeEach, describe, expect, it, vi } from 'vitest';

const isRunning = vi.fn();
const hasBackgroundTasks = vi.fn();
const listBackgroundTaskIds = vi.fn();

vi.mock('@/lib/executor/adapter', () => ({
  isRunning: (id: string) => isRunning(id),
  hasBackgroundTasks: (id: string) => hasBackgroundTasks(id),
  listBackgroundTaskIds: (id: string) => listBackgroundTaskIds(id),
}));

import { GET } from './route';

describe('GET /api/sessions/:id/runtime-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns root and background runtime axes independently', async () => {
    isRunning.mockReturnValue(false);
    hasBackgroundTasks.mockReturnValue(true);
    listBackgroundTaskIds.mockReturnValue(['child-1']);

    const response = await GET({} as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(await response.json()).toEqual({
      running: false,
      backgroundTasks: true,
      backgroundTaskIds: ['child-1'],
    });
    expect(isRunning).toHaveBeenCalledWith('session-1');
    expect(hasBackgroundTasks).toHaveBeenCalledWith('session-1');
    expect(listBackgroundTaskIds).toHaveBeenCalledWith('session-1');
  });
});
