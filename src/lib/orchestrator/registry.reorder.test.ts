import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

vi.mock('@/lib/db/queries', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/db/queries')>(),
  reorderTasksToTop: vi.fn(),
}));
vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true } }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));

import { MAX_REORDER_TASKS, reorderTasksToTop, TaskReorderError } from '@/lib/db/queries';
import { runAction } from './dispatch';
import { actions } from './registry';
import { registerAgentCommand } from '@/cli/commands/agent';

const input = { area_id: 'area', task_ids: ['first', 'second'], position: 'top' };
const action = 'reorder_tasks';

describe('task reordering action contract', () => {
  beforeEach(() => { vi.mocked(reorderTasksToTop).mockReset(); });

  it.each([false, true])('dispatches the same typed contract locally/remotely (%s)', async (remote) => {
    const result = { areaId: 'area', position: 'top' as const, taskIds: input.task_ids, changedTaskIds: input.task_ids };
    vi.mocked(reorderTasksToTop).mockResolvedValue(result);
    expect(await runAction(action, input, { remote })).toEqual({ ok: true, action, result });
    expect(reorderTasksToTop).toHaveBeenCalledWith({ areaId: 'area', taskIds: ['first', 'second'] });
    expect(actions.find((a) => a.name === action)?.mutating).toBe(true);
  });

  it('defaults to top and does not forward raw keys or lifecycle fields', async () => {
    await runAction(action, { area_id: 'area', task_ids: ['first'], sort_key: 'a0', status: 'done' }, { remote: false });
    expect(reorderTasksToTop).toHaveBeenCalledWith({ areaId: 'area', taskIds: ['first'] });
  });

  it.each(['["first","second"]', 'first,second'])('parses generated CLI array flag %s', async (flag) => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const program = new Command().exitOverride();
      registerAgentCommand(program);
      await program.parseAsync(['node', 'ri', 'agent', action, '--area-id', 'area', '--task-ids', flag, '--position', 'top']);
      expect(reorderTasksToTop).toHaveBeenCalledWith({ areaId: 'area', taskIds: ['first', 'second'] });
    } finally {
      stdout.mockRestore();
    }
  });

  it.each([
    { task_ids: [] },
    { task_ids: ['same', 'same'] },
    { task_ids: ['first', ' '] },
    { task_ids: Array.from({ length: MAX_REORDER_TASKS + 1 }, (_, i) => `id-${i}`) },
    { area_id: '' },
    { position: 'bottom' },
  ])('rejects invalid request %j before storage access', async (invalid) => {
    expect(await runAction(action, { ...input, ...invalid }, { remote: false }))
      .toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    expect(reorderTasksToTop).not.toHaveBeenCalled();
  });

  it.each(['conflict', 'not_found', 'invalid_params'] as const)('maps query %s to a stable ActionError envelope', async (code) => {
    vi.mocked(reorderTasksToTop).mockRejectedValue(new TaskReorderError(code, 'Reorder rejected.'));
    expect(await runAction(action, input, { remote: false }))
      .toMatchObject({ ok: false, error: { code, message: 'Reorder rejected.' } });
  });
});
