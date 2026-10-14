import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

vi.mock('@/lib/db/queries', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/db/queries')>(),
  rankTask: vi.fn(),
}));
vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true } }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));

import { rankTask, TaskReorderError } from '@/lib/db/queries';
import { runAction } from './dispatch';
import { actions } from './registry';
import { registerAgentCommand } from '@/cli/commands/agent';

const action = 'rank_task';

describe('rank_task action contract', () => {
  beforeEach(() => { vi.mocked(rankTask).mockReset(); });

  it.each([false, true])('dispatches the same typed contract locally/remotely (%s)', async (remote) => {
    const result = { id: 'task', rank: 3, total: 40 };
    vi.mocked(rankTask).mockResolvedValue(result);
    expect(await runAction(action, { id: 'task', rank: 3 }, { remote })).toEqual({ ok: true, action, result });
    expect(rankTask).toHaveBeenCalledWith('task', 3);
    expect(actions.find((a) => a.name === action)?.mutating).toBe(true);
  });

  it('takes the id and rank as CLI positionals, the rank as a number', async () => {
    vi.mocked(rankTask).mockResolvedValue({ id: 'task', rank: 3, total: 40 });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const program = new Command().exitOverride();
      registerAgentCommand(program);
      await program.parseAsync(['node', 'ri', 'agent', action, 'task', '3']);
      expect(rankTask).toHaveBeenCalledWith('task', 3);
    } finally {
      stdout.mockRestore();
    }
  });

  it.each([
    { id: 'task', rank: 0 },
    { id: 'task', rank: 1.5 },
    { id: 'task', rank: '3' },
    { id: ' ', rank: 1 },
    { id: 'task' },
  ])('rejects invalid request %j before storage access', async (invalid) => {
    expect(await runAction(action, invalid, { remote: false }))
      .toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    expect(rankTask).not.toHaveBeenCalled();
  });

  it.each(['conflict', 'not_found', 'invalid_params'] as const)('maps query %s to a stable ActionError envelope', async (code) => {
    vi.mocked(rankTask).mockRejectedValue(new TaskReorderError(code, 'Rank rejected.'));
    expect(await runAction(action, { id: 'task', rank: 1 }, { remote: false }))
      .toMatchObject({ ok: false, error: { code, message: 'Rank rejected.' } });
  });
});
