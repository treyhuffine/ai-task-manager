import { Command } from 'commander';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/service/client', () => ({ serviceRequest: mocks.request }));
import { registerUpdateCommand } from './update';
const policy = { channel: 'stable', automaticDownload: true, metered: false };
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });
function run(...args: string[]) {
  const program = new Command().exitOverride().configureOutput({ writeErr: () => {} });
  registerUpdateCommand(program);
  return program.parseAsync(['node', 'ri', 'update', ...args]);
}
it('shows safe preference values without mutating configuration', async () => {
  mocks.request.mockResolvedValue({ update: { policy }, identity: { root: '/private-home' } });
  await run('preferences');
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith('/update');
  expect(console.info).toHaveBeenCalledWith(JSON.stringify(policy, null, 2));
});
it('reports an unconfigured publisher without manufacturing one', async () => {
  mocks.request.mockResolvedValue({ update: { policy: null } });
  await run('preferences');
  expect(console.info).toHaveBeenCalledWith(JSON.stringify({ configured: false }, null, 2));
});
it('changes only explicitly supplied preferences through the shared owner socket', async () => {
  mocks.request.mockResolvedValue({ policy: { ...policy, metered: true } });
  await run('preferences', '--metered', 'on');
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith('/update/policy', 'PATCH', 3000, { metered: true });
});
it('supports both explicit on and off settings', async () => {
  mocks.request.mockResolvedValue({ policy });
  await run('preferences', '--automatic-download', 'off', '--metered', 'off');
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith('/update/policy', 'PATCH', 3000, { automaticDownload: false, metered: false });
});
it.each([['--metered', 'maybe'], ['--automatic-download', 'false'], ['--feed', 'https://attacker.example']])('rejects invalid or unsupported options %j', async (flag, value) => {
  await expect(run('preferences', flag, value)).rejects.toThrow();
  expect(mocks.request).not.toHaveBeenCalled();
});
it('propagates service failure instead of printing success', async () => {
  mocks.request.mockRejectedValue(new Error('No release publisher configured'));
  await expect(run('preferences', '--metered', 'on')).rejects.toThrow('No release publisher');
  expect(console.info).not.toHaveBeenCalled();
});
