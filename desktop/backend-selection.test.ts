import { expect, it, vi } from 'vitest';
import type { ServiceSession, ServiceStatus } from '../src/lib/service/client';
import { attachExistingOwner, runtimeForOwner } from './backend-selection';
const active = { repo: '/managed/server', node: '/managed/node/bin/node', launcher: '/managed/launch' };
it('reuses only the runtime belonging to the running owner', () => {
  expect(runtimeForOwner({ repo: active.repo, node: active.node }, active)).toEqual(active);
  expect(runtimeForOwner({ repo: '/source/checkout', node: '/source/node' }, active)).toEqual({ repo: '/source/checkout', node: '/source/node' });
  expect(runtimeForOwner({ repo: active.repo, node: '/another/node' }, active)).toEqual({ repo: active.repo, node: '/another/node' });
});
it('withholds local binary actions for older unmanaged owners without node metadata', () => {
  expect(runtimeForOwner({ repo: '/source/checkout' }, active)).toBeUndefined();
  expect(runtimeForOwner({ repo: '/source/checkout' }, null)).toBeUndefined();
  expect(runtimeForOwner({ repo: 'relative', node: '/node' }, null)).toBeUndefined();
  expect(runtimeForOwner({ repo: '/source', node: 'node' }, null)).toBeUndefined();
  expect(runtimeForOwner({ repo: active.repo }, active)).toEqual(active);
});
it('attaches directly to the existing service without any binary selection operation', async () => {
  const ready = { phase: 'running', repo: '/source', node: '/node' } as ServiceSession;
  const session = vi.fn().mockResolvedValue(ready);
  const status = vi.fn().mockResolvedValue(ready);
  expect(await attachExistingOwner({ status, session })).toBe(ready);
  expect(session).toHaveBeenCalledOnce();
});
it('waits for the existing owner startup but never substitutes a missing owner', async () => {
  const ready = { phase: 'running' } as ServiceSession;
  const status = vi.fn().mockResolvedValueOnce({ phase: 'starting' }).mockResolvedValueOnce(ready);
  const session = vi.fn().mockResolvedValue(ready);
  expect(await attachExistingOwner({ status, session, delay: async () => {} })).toBe(ready);
  status.mockResolvedValue(null); session.mockClear();
  await expect(attachExistingOwner({ status, session })).rejects.toThrow('existing service stopped');
  expect(session).not.toHaveBeenCalled();
});
it('surfaces failed and stopping owners without attempting recovery or replacement', async () => {
  for (const phase of ['failed', 'stopping'] as const) {
    const session = vi.fn();
    await expect(attachExistingOwner({ status: async () => ({ phase } as ServiceStatus), session })).rejects.toThrow();
    expect(session).not.toHaveBeenCalled();
  }
});
