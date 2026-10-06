import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listener: undefined as ((request: IncomingMessage, response: ServerResponse) => void) | undefined,
  handle: vi.fn(async () => {}),
  maintenance: vi.fn(() => null),
  activity: vi.fn(() => vi.fn()),
  pinnedBeforePrepare: undefined as unknown,
}));
vi.mock('next', () => ({ default: () => ({ prepare: async () => { mocks.pinnedBeforePrepare = globalThis.__riServedRelease; }, getRequestHandler: () => mocks.handle, close: async () => {} }) }));
vi.mock('node:http', () => ({ default: { createServer: (listener: typeof mocks.listener) => {
  if (!listener) return new EventEmitter();
  mocks.listener = listener;
  return { on: vi.fn(), once: vi.fn(), listen: (_port: number, _host: string, ready: () => void) => ready() };
} } }));
vi.mock('@/lib/service/maintenance', () => ({ readMaintenance: mocks.maintenance, beginActivity: mocks.activity }));
vi.mock('@/lib/executor/status-snapshot', () => ({ listRunningSessions: () => [], listBackgroundTaskSessions: () => [], listSessionsWithPending: () => [] }));
vi.mock('./watchdog', () => ({}));

beforeAll(async () => {
  vi.stubEnv('NODE_ENV', process.env.NODE_ENV);
  vi.stubEnv('RI_TRPC_WS_HOST', process.env.RI_TRPC_WS_HOST);
  vi.spyOn(process, 'once').mockReturnValue(process);
  if (process.send) vi.spyOn(process, 'send').mockReturnValue(true);
  await import('./http-server');
  await vi.waitFor(() => expect(mocks.listener).toBeTypeOf('function'));
});
beforeEach(() => { mocks.handle.mockClear(); mocks.activity.mockClear(); });
afterAll(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function request(url: string) {
  const response = Object.assign(new EventEmitter(), { writeHead: vi.fn().mockReturnThis(), end: vi.fn().mockReturnThis() });
  mocks.listener!({ url, method: 'GET', headers: {} } as IncomingMessage, response as unknown as ServerResponse);
  return response;
}
it.each(['//', '//[', 'http://['])('rejects malformed request target %s without crashing the service', target => {
  const response = request(target);
  expect(response.writeHead).toHaveBeenCalledWith(400, expect.objectContaining({ 'Cache-Control': 'no-store' }));
  expect(response.end).toHaveBeenCalled();
  expect(mocks.handle).not.toHaveBeenCalled();
  expect(mocks.activity).not.toHaveBeenCalled();
  // The same request boundary still handles subsequent ordinary traffic.
  request('/api/health');
  expect(mocks.handle).toHaveBeenCalledOnce();
});
it('pins the served release before Next reads its build', () => {
  expect(mocks.pinnedBeforePrepare).toMatchObject({ release: { build: expect.any(String) } });
  expect(globalThis.__riServedRelease).toBe(mocks.pinnedBeforePrepare);
});
