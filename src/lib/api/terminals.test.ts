import { afterEach, expect, it, vi } from 'vitest';
import { terminalsApi } from './terminals';
import { subscribeTerminalOutput } from '@/lib/realtime/terminal-transport';
import { terminalsUnavailable } from '@/hooks/use-terminals';
import { ApiError } from './client';
import { WebSocketUnavailable } from '@/lib/trpc/transport-link';
import { setTransportMode } from '@/lib/trpc/transport-state';

const { calls, unsubscribe } = vi.hoisted(() => ({ calls: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('@/lib/trpc/client', () => {
  const client = (path: string[]): object => new Proxy({}, { get: (_target, key: string) => {
    if (key === 'query' || key === 'mutate') return (...args: unknown[]) => { calls([...path, key].join('.'), ...args); return Promise.resolve([]); };
    if (key === 'subscribe') return (...args: unknown[]) => { calls([...path, key].join('.'), ...args); return { unsubscribe }; };
    return client([...path, key]);
  } });
  return { terminalTRPCClient: client([]), trpcClient: {} };
});
afterEach(() => { vi.clearAllMocks(); setTransportMode('websocket'); });

it.each(['/sessions/chat', '/workspaces/agent'] as const)('uses the independent terminal client for every control call in HTTP mode (%s)', async base => {
  setTransportMode('http');
  await terminalsApi.list(base);
  await terminalsApi.create(base, { cols: 80, rows: 24 });
  await terminalsApi.input(base, 'shell', 'typed');
  await terminalsApi.resize(base, 'shell', { cols: 100, rows: 40 });
  await terminalsApi.kill(base, 'shell');
  expect(calls).toHaveBeenCalledTimes(5);
  expect(calls.mock.calls.map(call => call[0].split('.')[0])).toEqual(Array(5).fill(base.startsWith('/sessions') ? 'sessions' : 'workspaces'));
});

it('uses the terminal subscription in HTTP mode and keeps it when the API mode changes', () => {
  setTransportMode('http');
  const stop = subscribeTerminalOutput('/sessions/chat', 'shell', { after: 5 }, vi.fn());
  expect(calls).toHaveBeenCalledWith('terminals.output.subscribe', { base: '/sessions/chat', terminalId: 'shell', after: 5 }, expect.anything());
  setTransportMode('websocket');
  setTransportMode('http');
  expect(calls).toHaveBeenCalledOnce();
  expect(unsubscribe).not.toHaveBeenCalled();
  stop();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it('recognizes transport and device outages without hiding other errors', () => {
  expect(terminalsUnavailable(new WebSocketUnavailable())).toContain('Reconnecting');
  expect(terminalsUnavailable(new ApiError(409, { error: 'unavailable', message: 'Device is away.' }, '/api'))).toBe('Device is away.');
  expect(terminalsUnavailable(new ApiError(503, { error: 'maintenance' }, '/api'))).toBeNull();
  expect(terminalsUnavailable(new ApiError(409, { error: 'conflict' }, '/api'))).toBeNull();
});
