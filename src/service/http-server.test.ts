import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listener: undefined as ((request: IncomingMessage, response: ServerResponse) => void) | undefined,
  handle: vi.fn(async () => {}),
  maintenance: vi.fn(() => null),
  activity: vi.fn(() => vi.fn()),
}));
vi.mock('next', () => ({ default: () => ({ prepare: async () => {}, getRequestHandler: () => mocks.handle, close: async () => {} }) }));
vi.mock('node:http', () => ({ default: { createServer: (listener: typeof mocks.listener) => {
  mocks.listener = listener;
  return { on: vi.fn(), once: vi.fn(), listen: (_port: number, _host: string, ready: () => void) => ready() };
} } }));
vi.mock('@/lib/service/maintenance', () => ({ readMaintenance: mocks.maintenance, beginActivity: mocks.activity }));
vi.mock('@/lib/executor/status-snapshot', () => ({ listRunningSessions: () => [], listBackgroundTaskSessions: () => [], listSessionsWithPending: () => [] }));
vi.mock('./watchdog', () => ({}));

beforeAll(async () => {
  vi.spyOn(process, 'once').mockReturnValue(process);
  if (process.send) vi.spyOn(process, 'send').mockReturnValue(true);
  await import('./http-server');
  await vi.waitFor(() => expect(mocks.listener).toBeTypeOf('function'));
});
beforeEach(() => { mocks.handle.mockClear(); mocks.activity.mockClear(); });
afterAll(() => { vi.restoreAllMocks(); });
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
