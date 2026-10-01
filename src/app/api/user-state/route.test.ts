import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * PATCH /api/user-state for the orchestrator's name. The name is stored one
 * line, null when blank (the default), and capped. It lives in the app main
 * chat's brief, which is fixed at spawn, so a real change recycles that chat
 * and nothing else.
 */

const recycleAppMainChats = vi.fn<() => Promise<void>>(async () => {});
vi.mock('@/lib/executor/adapter', () => ({
  recycleAppMainChats: () => recycleAppMainChats(),
}));

let stored: Record<string, unknown> = { id: 1, orchestratorName: null };
const updateUserState = vi.fn((input: Record<string, unknown>) => {
  stored = { ...stored, ...input };
  return stored;
});
vi.mock('@/lib/db/queries', () => ({
  getUserState: () => stored,
  updateUserState: (input: Record<string, unknown>) => updateUserState(input),
}));

const { PATCH } = await import('./route');

function patch(body: unknown) {
  return PATCH(new NextRequest('http://localhost/api/user-state', { method: 'PATCH', body: JSON.stringify(body) }));
}

beforeEach(() => {
  stored = { id: 1, orchestratorName: null };
  recycleAppMainChats.mockClear();
  updateUserState.mockClear();
});

describe('PATCH /api/user-state orchestratorName', () => {
  it('stores a new name on one line and recycles the main chat', async () => {
    const res = await patch({ orchestratorName: '  Chief\nof   Staff ' });
    expect(res.status).toBe(200);
    expect(updateUserState).toHaveBeenCalledWith({ orchestratorName: 'Chief of Staff' });
    expect(recycleAppMainChats).toHaveBeenCalledTimes(1);
  });

  it('stores a blank name as null, back to the default', async () => {
    stored.orchestratorName = 'Atlas';
    await patch({ orchestratorName: '   ' });
    expect(updateUserState).toHaveBeenCalledWith({ orchestratorName: null });
    expect(recycleAppMainChats).toHaveBeenCalledTimes(1);
  });

  it('leaves the main chat alone when the name did not change', async () => {
    stored.orchestratorName = 'Atlas';
    await patch({ orchestratorName: 'Atlas ' });
    expect(recycleAppMainChats).not.toHaveBeenCalled();
  });

  it('leaves the main chat alone for every other setting', async () => {
    await patch({ name: 'Trey' });
    expect(recycleAppMainChats).not.toHaveBeenCalled();
  });

  it('refuses a name that is too long or not text', async () => {
    const long = await patch({ orchestratorName: 'x'.repeat(41) });
    expect(long.status).toBe(400);
    const notText = await patch({ orchestratorName: 7 });
    expect(notText.status).toBe(400);
    expect(updateUserState).not.toHaveBeenCalled();
  });

  it('still saves the name when the recycle fails', async () => {
    recycleAppMainChats.mockRejectedValueOnce(new Error('runner down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await patch({ orchestratorName: 'Atlas' });
    expect(res.status).toBe(200);
    expect(stored.orchestratorName).toBe('Atlas');
    warn.mockRestore();
  });
});
