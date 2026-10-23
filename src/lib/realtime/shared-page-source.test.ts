import { afterEach, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock('@/lib/trpc/client', () => ({ terminalTRPCClient: { live: { output: { subscribe: transport.subscribe } } } }));
import { openSharedPageSource } from './shared-page-source';
import { pageStream, _resetPageStream } from './page-stream';

afterEach(() => { transport.subscribe.mockReset(); _resetPageStream(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('adapts typed socket events to the common page stream and cancels delivery on close', async () => {
  let callbacks: { onData(frame: { event: string; data: unknown }): void; onError(error: unknown): void };
  const stop = vi.fn();
  transport.subscribe.mockImplementation((_input, listener) => { callbacks = listener; return { unsubscribe: stop }; });
  const input = { s: [['chat', 'delivered-event', '2026-10-19 00:00:00']], t: [] };
  const source = openSharedPageSource('/api/live?sub=' + encodeURIComponent(JSON.stringify(input)));
  const delivered = vi.fn(); source.addEventListener('session', delivered); source.onerror = vi.fn();
  await Promise.resolve();
  expect(transport.subscribe).toHaveBeenCalledWith(input, expect.anything());
  callbacks!.onData({ event: 'session', data: { s: 'chat', e: 'chat_event', i: 'next-event' } });
  expect(JSON.parse((delivered.mock.calls[0][0] as MessageEvent).data)).toMatchObject({ i: 'next-event' });
  callbacks!.onError(new Error('Disconnected')); expect(source.onerror).toHaveBeenCalledOnce();
  source.close(); callbacks!.onData({ event: 'session', data: {} }); expect(delivered).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
});

it.each(['team', 'space'])('uses the authenticated socket for a %s document while retaining PageStream cursors', async authority => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { documentElement: { dataset: { riAuthority: authority } }, visibilityState: 'visible', addEventListener() {} });
  const stop = vi.fn(); transport.subscribe.mockReturnValue({ unsubscribe: stop });
  const leave = pageStream().subscribeSession('shared-chat', () => {});
  await vi.advanceTimersByTimeAsync(25);
  expect(transport.subscribe).toHaveBeenCalledWith({ s: [['shared-chat', null, null]], t: [] }, expect.anything());
  leave(); await vi.advanceTimersByTimeAsync(25); expect(stop).toHaveBeenCalledOnce();
});

it('does not start a socket subscription after disposal before its first microtask', async () => {
  const source = openSharedPageSource('/api/live?sub=' + encodeURIComponent(JSON.stringify({ s: [], t: [] })));
  source.close(); await Promise.resolve(); expect(transport.subscribe).not.toHaveBeenCalled();
});
