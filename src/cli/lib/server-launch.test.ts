import { beforeEach, expect, it, vi } from 'vitest';
const processTools = vi.hoisted(() => ({ spawn: vi.fn(() => ({})), spawnSync: vi.fn() }));
vi.mock('node:child_process', () => processTools);
import { startNextServer } from './server';
beforeEach(() => processTools.spawn.mockClear());

it('uses the same WebSocket host for direct production and development launches', () => {
  startNextServer({ port: 41234, repo: '/runtime', node: '/node', dev: true });
  expect(processTools.spawn).toHaveBeenCalledWith('/node', ['/runtime/dist/service/http-server.cjs'], expect.objectContaining({
    cwd: '/runtime', env: expect.objectContaining({ PORT: '41234', RI_DESKTOP_MODE: 'development', NODE_ENV: 'development', RI_HTTP_HOST: '0.0.0.0' }),
  }));
  startNextServer({ port: 41235, repo: '/runtime', dev: false, hostname: '127.0.0.1' });
  expect(processTools.spawn).toHaveBeenLastCalledWith(process.execPath, ['/runtime/dist/service/http-server.cjs'], expect.objectContaining({
    env: expect.objectContaining({ PORT: '41235', RI_DESKTOP_MODE: 'production', NODE_ENV: 'production', RI_HTTP_HOST: '127.0.0.1' }),
  }));
});

it('keeps the supervised backend private and preserves controller credentials and validation', () => {
  startNextServer({ port: 41236, repo: '/runtime', supervised: true, env: { NODE_ENV: 'production', RI_SERVICE_CONTROL_TOKEN: 'fixture', RI_SERVICE_VALIDATING: '1', RI_HTTP_HOST: '0.0.0.0' } });
  expect(processTools.spawn).toHaveBeenCalledWith(process.execPath, ['/runtime/dist/service/http-server.cjs'], expect.objectContaining({
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: expect.objectContaining({ RI_HTTP_HOST: '127.0.0.1', RI_SERVICE_VALIDATING: '1', RI_SERVICE_CONTROL_TOKEN: 'fixture' }),
  }));
});

it('lets portless allocate the port while selecting the shared development host', () => {
  startNextServer({ port: 41234, repo: '/runtime', dev: true, portlessName: 'ri-test' });
  const [, args, options] = processTools.spawn.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }];
  expect(args).toEqual(['ri-test', process.execPath, '/runtime/dist/service/http-server.cjs']);
  expect(args).not.toContain('41234');
  expect(options.env.PORT).toBe(process.env.PORT);
  expect(options.env.RI_DESKTOP_MODE).toBe('development');
});
