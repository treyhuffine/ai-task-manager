import { afterEach, expect, it, vi } from 'vitest';
import { subscribeTerminalOutput } from './terminal-transport';
import type { TerminalFrame } from '@/lib/trpc/terminal-subscription';
import type { TransportMode, TransportStatus } from '@/lib/trpc/transport-state';
afterEach(() => vi.useRealTimers());

function fixture() {
  let mode: TransportMode = 'websocket';
  let state: TransportStatus['state'] = 'websocket';
  const position = { after: 5 as number | null, mark: 'old-sse' as string | undefined };
  let changed = () => {};
  let deliver: (frame: TerminalFrame) => void = () => {};
  let fail = () => {};
  const wsStop = vi.fn(), sseStop = vi.fn(), listener = vi.fn();
  const ws = vi.fn((send: typeof deliver, error: () => void) => { deliver = send; fail = error; return wsStop; });
  const sse = vi.fn(() => sseStop);
  const unwatch = vi.fn();
  const env = { getMode: () => mode, getStatus: () => ({ state, reason: null, httpRequests: 0, websocketRequests: 0, httpMs: null, websocketMs: null }),
    subscribe: (fn: () => void) => { changed = fn; return unwatch; }, sse, ws, document: undefined as Document | undefined };
  const start = () => subscribeTerminalOutput('/sessions/chat', 'terminal', position, listener, env);
  return { start, env, position, ws, sse, wsStop, sseStop, listener, unwatch, deliver: (frame: TerminalFrame) => deliver(frame), fail: () => fail(),
    change: (next: TransportStatus['state'], preference = mode) => { state = next; mode = preference; changed(); } };
}

it('moves only the delivered cursor and keeps it when falling back to SSE', () => {
  const f = fixture(), stop = f.start();
  expect(f.position.mark).toBeUndefined();
  f.deliver({ event: 'ready', data: { id: 'terminal', resumed: true } });
  f.deliver({ event: 'data', data: 'abc', id: '8' });
  expect(f.position.after).toBe(8);
  f.change('fallback');
  expect(f.wsStop).toHaveBeenCalledOnce();
  expect(f.sse).toHaveBeenCalledOnce();
  f.deliver({ event: 'data', data: 'stale', id: '100' });
  expect(f.position.after).toBe(8);
  f.change('websocket');
  expect(f.sseStop).toHaveBeenCalledOnce();
  expect(f.ws).toHaveBeenCalledTimes(2);
  stop();
  expect(f.unwatch).toHaveBeenCalledOnce();
});

it('falls back on a subscription error without reopening the same failing subscription', () => {
  const f = fixture(), stop = f.start();
  f.fail();
  expect(f.ws).toHaveBeenCalledOnce();
  expect(f.sse).toHaveBeenCalledOnce();
  f.change('websocket');
  expect(f.ws).toHaveBeenCalledOnce();
  stop();
});

it('switches to HTTP with no screen reset, and resets only on a non-resumed ready', () => {
  const f = fixture(), stop = f.start();
  f.deliver({ event: 'ready', data: { id: 'terminal', resumed: false } });
  expect(f.position.after).toBeNull();
  f.deliver({ event: 'data', data: 'snapshot', id: '20' });
  f.change('http', 'http');
  expect(f.position.after).toBe(20);
  expect(f.sse).toHaveBeenCalledOnce();
  stop();
});

it('releases hidden screens and resumes from their cursor when shown', () => {
  vi.useFakeTimers();
  const f = fixture();
  const doc = new EventTarget() as Document;
  Object.defineProperty(doc, 'visibilityState', { value: 'visible', configurable: true });
  f.env.document = doc;
  const stop = f.start();
  Object.defineProperty(doc, 'visibilityState', { value: 'hidden', configurable: true });
  doc.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(5_000);
  expect(f.wsStop).toHaveBeenCalledOnce();
  Object.defineProperty(doc, 'visibilityState', { value: 'visible', configurable: true });
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(f.ws).toHaveBeenCalledTimes(2);
  expect(f.position.after).toBe(5);
  stop();
});
