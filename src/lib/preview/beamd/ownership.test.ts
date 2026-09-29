import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn(), close: vi.fn() }));
vi.mock('./cli', () => ({ beamdList: mocks.list, beamdOpen: mocks.open, beamdClose: mocks.close, BeamdCliError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));
import { openOwnedTunnel, closeOwnedTunnel } from './ownership';
afterEach(() => vi.clearAllMocks());
it('refuses to reuse or retarget another backend', async () => {
  mocks.list.mockResolvedValue([{ name: 'ri', port: 4000, healthy: true, url: 'https://ri.example' }]);
  await expect(openOwnedTunnel(5000, 'ri')).rejects.toThrow('another'); expect(mocks.open).not.toHaveBeenCalled();
});
it('reuses only the matching healthy destination', async () => {
  mocks.list.mockResolvedValue([{ name: 'ri', port: 5000, healthy: true, url: 'https://ri.example' }]);
  expect((await openOwnedTunnel(5000, 'ri')).url).toBe('https://ri.example'); expect(mocks.open).not.toHaveBeenCalled();
});
it('does not close a tunnel whose destination changed', async () => {
  mocks.list.mockResolvedValue([{ name: 'ri', port: 4000 }]); await closeOwnedTunnel(5000, 'ri'); expect(mocks.close).not.toHaveBeenCalled();
  mocks.list.mockResolvedValue([{ name: 'ri', port: 5000 }]); await closeOwnedTunnel(5000, 'ri'); expect(mocks.close).toHaveBeenCalledWith('ri', { cwd: undefined });
});
