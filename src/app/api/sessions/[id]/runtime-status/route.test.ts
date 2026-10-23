import { beforeEach, describe, expect, it, vi } from 'vitest';

const isRunning = vi.fn();
const hasUnconfirmedClose = vi.fn();
const unconfirmedCloseProblem = vi.fn();
const hasBackgroundTasks = vi.fn();
const listBackgroundTaskIds = vi.fn();

vi.mock('@/lib/executor/adapter', () => ({
  isRunning: (id: string) => isRunning(id),
  hasUnconfirmedClose: (id: string) => hasUnconfirmedClose(id),
  unconfirmedCloseProblem: (id: string) => unconfirmedCloseProblem(id),
  hasBackgroundTasks: (id: string) => hasBackgroundTasks(id),
  listBackgroundTaskIds: (id: string) => listBackgroundTaskIds(id),
}));

import { GET } from './route';

describe('GET /api/sessions/:id/runtime-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasUnconfirmedClose.mockReturnValue(false);
    unconfirmedCloseProblem.mockReturnValue(undefined);
  });

  it('returns root and background runtime axes independently', async () => {
    isRunning.mockReturnValue(false);
    hasBackgroundTasks.mockReturnValue(true);
    listBackgroundTaskIds.mockReturnValue(['child-1']);

    const response = await GET(new Request('http://localhost/api') as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(await response.json()).toEqual({
      running: false,
      backgroundTasks: true,
      backgroundTaskIds: ['child-1'],
      canStop: true,
      canAnswer: true,
      canApprove: true,
      activeTurnId: null,
    });
    expect(hasUnconfirmedClose).toHaveBeenCalledWith('session-1');
    expect(isRunning).toHaveBeenCalledWith('session-1');
    expect(hasBackgroundTasks).toHaveBeenCalledWith('session-1');
    expect(listBackgroundTaskIds).toHaveBeenCalledWith('session-1');
  });
  it('reports an unconfirmed idle close for the shared recovery control', async () => {
    isRunning.mockReturnValue(false);
    hasBackgroundTasks.mockReturnValue(false);
    listBackgroundTaskIds.mockReturnValue([]);
    hasUnconfirmedClose.mockReturnValue(true);
    unconfirmedCloseProblem.mockReturnValue('Inspect pid 123 (node), then use Restart chat.');
    const response = await GET(new Request('http://localhost/api') as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });
    expect(await response.json()).toMatchObject({ closeUnconfirmed: true, closeProblem: 'Inspect pid 123 (node), then use Restart chat.', running: false, backgroundTasks: false });
  });
});
