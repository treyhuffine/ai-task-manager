import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { APP_ROOT_ENV, getAppRoot, getDevAppRoot } from '@/lib/config/paths';
const mocks = vi.hoisted(() => ({ ensure: vi.fn(), installed: vi.fn(), status: vi.fn(), request: vi.fn(), awake: vi.fn() }));
vi.mock('@/lib/service/client', () => ({ ensureServiceStatus: mocks.ensure, serviceStatus: mocks.status, serviceRequest: mocks.request, stopService: vi.fn() }));
vi.mock('@/lib/service/awake', () => ({ readAwakePreferences: mocks.awake }));
vi.mock('@/lib/service/runtime', () => ({ installedRuntime: mocks.installed, createRuntimeManifest: vi.fn(), stageRuntime: vi.fn(), verifyRuntime: vi.fn() }));
import { registerServiceCommand } from './service';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv(APP_ROOT_ENV, undefined);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  mocks.installed.mockReturnValue(null);
  mocks.status.mockResolvedValue(null);
  mocks.awake.mockReturnValue({ enabled: false });
  mocks.ensure.mockImplementation(async () => ({ origin: 'https://localhost:42242', identity: { root: getAppRoot() } }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function run(...args: string[]) {
  const program = new Command().exitOverride();
  registerServiceCommand(program);
  return program.parseAsync(['node', 'ri', 'service', ...args]);
}
it('selects the development home before looking up or starting its service', async () => {
  mocks.installed.mockImplementation(() => { expect(getAppRoot()).toBe(getDevAppRoot()); return null; });
  await run('start', '--dev');
  expect(mocks.ensure).toHaveBeenCalledWith(expect.objectContaining({ env: expect.objectContaining({ [APP_ROOT_ENV]: getDevAppRoot(), RI_DESKTOP_MODE: 'development' }) }));
});
it('keeps an explicit environment root in development mode', async () => {
  vi.stubEnv(APP_ROOT_ENV, '/explicit/home');
  await run('start', '--dev');
  expect(getAppRoot()).toBe('/explicit/home');
});
it('gives the explicit service root priority over the environment and development default', async () => {
  vi.stubEnv(APP_ROOT_ENV, '/environment/home');
  await run('--root', './explicit-service-home', 'start', '--dev');
  expect(getAppRoot()).toBe(path.resolve('./explicit-service-home'));
});
it('keeps the production default when development mode was not requested', async () => {
  const original = getAppRoot();
  await run('start');
  expect(getAppRoot()).toBe(original);
  expect(mocks.ensure).toHaveBeenCalledWith(expect.objectContaining({ env: expect.objectContaining({ RI_DESKTOP_MODE: 'production' }) }));
});
it('changes keep-awake through the live controller and never starts a service implicitly', async () => {
  mocks.status.mockResolvedValue({ phase: 'running' });
  await run('awake', 'on');
  expect(mocks.request).toHaveBeenLastCalledWith('/awake', 'PATCH', 10_000, { enabled: true });
  await run('awake', 'off');
  expect(mocks.request).toHaveBeenLastCalledWith('/awake', 'PATCH', 10_000, { enabled: false });
  await run('awake');
  expect(mocks.request).toHaveBeenLastCalledWith('/awake', 'GET', 10_000, undefined);
  expect(mocks.ensure).not.toHaveBeenCalled();
});
it('shows the retained preference while stopped and requires explicit service start for changes', async () => {
  mocks.awake.mockReturnValue({ enabled: true });
  await run('awake', 'status');
  expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"stopped"'));
  expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"enabled": true'));
  await expect(run('awake', 'on')).rejects.toThrow('Start the background service');
  await expect(run('awake', 'wat')).rejects.toThrow('Choose on, off, or status');
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.ensure).not.toHaveBeenCalled();
});

it('refreshes an existing connected controller after CLI enrollment without starting another Home', async () => {
  mocks.status.mockResolvedValue({ phase: 'running', role: 'viewer' });
  await run('start');
  expect(mocks.request).toHaveBeenCalledWith('/role/refresh', 'POST', 200_000);
  expect(mocks.ensure).toHaveBeenCalledOnce();
});
