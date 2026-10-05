import { afterEach, expect, it, vi } from 'vitest';
import { terminalsApi } from './terminals';
import { subscribeTerminalOutput } from '@/lib/realtime/terminal-transport';
import { terminalsUnavailable } from '@/hooks/use-terminals';
import { ApiError } from './client';
import { WebSocketUnavailable } from '@/lib/trpc/transport-link';
import { setTransportMode } from '@/lib/trpc/transport-state';
import { homeTerminals, sessionFolder, terminalApiBase, terminalFolder, terminalSourceFromBase, workspaceFolder } from '@/lib/folders/source';

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

const ROUTER = { '/sessions/chat': 'sessions', '/workspaces/agent': 'workspaces', '/home': 'home' } as const;

it.each(['/sessions/chat', '/workspaces/agent', '/home'] as const)('uses the independent terminal client for every control call in HTTP mode (%s)', async base => {
  setTransportMode('http');
  await terminalsApi.list(base);
  await terminalsApi.create(base, { cols: 80, rows: 24 });
  await terminalsApi.input(base, 'shell', 'typed');
  await terminalsApi.resize(base, 'shell', { cols: 100, rows: 40 });
  await terminalsApi.kill(base, 'shell');
  expect(calls).toHaveBeenCalledTimes(5);
  expect(calls.mock.calls.map(call => call[0].split('.')[0])).toEqual(Array(5).fill(ROUTER[base]));
});

// Home's shells (Home, More, Terminal) are addressed by terminal id alone:
// the server picks the folder, so no call carries one.
it("sends Home's calls to the home procedures, with no folder in them", async () => {
  await terminalsApi.list('/home');
  await terminalsApi.create('/home', { cols: 80, rows: 24 });
  await terminalsApi.input('/home', 't1', 'ls\r');
  await terminalsApi.resize('/home', 't1', { cols: 100, rows: 30 });
  await terminalsApi.kill('/home', 't1');
  expect(calls.mock.calls.map(call => call.slice(0, 2))).toEqual([
    ['home.terminalsGet.query', {}],
    ['home.terminalsPost.mutate', { body: { cols: 80, rows: 24 } }],
    ['home.terminalsInputTerminalIdPost.mutate', { params: { terminalId: 't1' }, body: { data: 'ls\r' } }],
    ['home.terminalsResizeTerminalIdPost.mutate', { params: { terminalId: 't1' }, body: { cols: 100, rows: 30 } }],
    ['home.terminalsTerminalIdDelete.mutate', { params: { terminalId: 't1' } }],
  ]);
});

it('round-trips every terminal source through its route base, and gives Home no folder', () => {
  for (const source of [sessionFolder('chat'), workspaceFolder('agent'), homeTerminals]) {
    expect(terminalSourceFromBase(terminalApiBase(source))).toEqual(source);
  }
  expect(terminalApiBase(homeTerminals)).toBe('/home');
  expect(terminalFolder(homeTerminals)).toBeNull();
  expect(terminalFolder(workspaceFolder('agent'))).toEqual(workspaceFolder('agent'));
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
