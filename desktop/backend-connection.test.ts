import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BackendMessage } from './config';

const f = vi.hoisted(() => ({
  setup: vi.fn(), status: vi.fn(), session: vi.fn(), send: vi.fn(), on: vi.fn(), once: vi.fn(),
  owner: { phase: 'running', role: 'viewer', runId: 'same-run' },
}));
vi.mock('./config', () => ({ demoEnvironment: () => ({}), bundledCliCommand: vi.fn() }));
vi.mock('../src/lib/service/client', () => ({ serviceStatus: f.status, serviceRequest: f.session, ensureServiceStatus: vi.fn() }));
vi.mock('./connection-setup', () => ({ connectionSetup: f.setup }));
vi.mock('./backend-selection', () => ({ attachExistingOwner: async () => f.owner, runtimeForOwner: () => undefined }));
vi.mock('../src/lib/service/runtime', () => ({ installedRuntime: () => null }));
vi.mock('../src/lib/service/initialization', () => ({ stageFirstDesktopRuntime: vi.fn() }));

const viewer = { homeUrl: 'https://home.example', homeId: 'home', homeName: 'My Ri', deviceId: 'device', signInKey: 'test-sign-in' };
const messages = (type: BackendMessage['type']) => f.send.mock.calls.map(([message]) => message as BackendMessage).filter(message => message.type === type);
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  f.owner.role = 'viewer';
  f.status.mockResolvedValue(f.owner);
  f.session.mockResolvedValue({ runId: 'same-run', origin: 'https://localhost:4224', certificate: 'cert', token: 'local', desktopClient: 'test-client' });
  f.setup.mockImplementation(async ({ action }) => action === 'inspect' ? { role: f.owner.role } : viewer);
  vi.stubGlobal('process', { ...process, env: { ...process.env, RI_DESKTOP_REPO: '/tmp/ri-backend-test' },
    connected: true, send: f.send, on: f.on, once: f.once });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('reports typed remote failures and announces recovery even when the Home session is unchanged', async () => {
  await import('./backend'); await flush();
  expect(messages('ready')).toHaveLength(1);
  f.setup.mockImplementation(async ({ action }) => {
    if (action === 'session') throw Object.assign(new Error('Device access removed.'), { problem: 'unauthorized' });
    return { role: 'viewer' };
  });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(messages('error')).toEqual([expect.objectContaining({ issue: expect.objectContaining({ kind: 'sign_in', detail: 'Device access removed.' }) })]);
  f.setup.mockResolvedValue(viewer);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(messages('ready')).toHaveLength(2);
});

it('recovers a local session probe failure without requiring a controller restart', async () => {
  f.owner.role = 'home';
  await import('./backend'); await flush();
  expect(messages('ready')).toHaveLength(1);
  f.session.mockRejectedValueOnce(new Error('Temporary local service failure.'));
  await vi.advanceTimersByTimeAsync(2_000);
  expect(messages('error')).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(messages('ready')).toHaveLength(2);
});

it('retries a failed renderer sign-in even when the helper connection itself stayed healthy', async () => {
  await import('./backend'); await flush();
  expect(messages('ready')).toHaveLength(1);
  f.on.mock.calls.find(([event]) => event === 'message')![1]({ type: 'retry-session' });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(messages('ready')).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(messages('ready')).toHaveLength(2);
});
