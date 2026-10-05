import { afterEach, expect, it, vi } from 'vitest';
import { subscribeTerminalOutput } from './terminal-transport';
import type { TerminalFrame } from '@/lib/trpc/terminal-subscription';
afterEach(() => vi.useRealTimers());

function fixture() {
  const position = { after: 5 as number | null, mark: 'old-sse' as string | undefined };
  const connections: { deliver: (frame: TerminalFrame) => void; fail: () => void; stop: ReturnType<typeof vi.fn> }[] = [];
  const listener = vi.fn();
  const ws = vi.fn((deliver: (frame: TerminalFrame) => void, fail: () => void) => {
    const stop = vi.fn();
    connections.push({ deliver, fail, stop });
    return stop;
  });
  const env = { ws, document: undefined as Document | undefined };
  const start = () => subscribeTerminalOutput('/sessions/chat', 'terminal', position, listener, env);
  return { start, env, position, ws, listener, connections };
}

it('connects directly to WS and reconnects only from delivered output', () => {
  vi.useFakeTimers();
  const f = fixture(), stop = f.start();
  expect(f.position.mark).toBeUndefined();
  expect(f.listener).toHaveBeenCalledWith('unavailable', expect.anything());
  f.connections[0].deliver({ event: 'ready', data: { id: 'terminal', resumed: true } });
  f.connections[0].deliver({ event: 'data', data: 'abc', id: '8' });
  f.connections[0].fail();
  expect(f.connections[0].stop).toHaveBeenCalledOnce();
  expect(f.position.after).toBe(8);
  expect(f.ws).toHaveBeenCalledOnce();
  f.connections[0].deliver({ event: 'data', data: 'stale', id: '100' });
  expect(f.position.after).toBe(8);
  vi.advanceTimersByTime(1_000);
  expect(f.ws).toHaveBeenCalledTimes(2);
  f.connections[1].deliver({ event: 'ready', data: { id: 'terminal', resumed: true } });
  expect(f.position.after).toBe(8);
  stop();
});

it('bounds reconnect backoff and cancels it on disposal', () => {
  vi.useFakeTimers();
  const f = fixture(), stop = f.start();
  for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
    const count = f.connections.length;
    f.connections.at(-1)!.fail();
    vi.advanceTimersByTime(delay - 1);
    expect(f.ws).toHaveBeenCalledTimes(count);
    vi.advanceTimersByTime(1);
    expect(f.ws).toHaveBeenCalledTimes(count + 1);
  }
  f.connections.at(-1)!.fail();
  stop();
  vi.advanceTimersByTime(60_000);
  expect(f.ws).toHaveBeenCalledTimes(8);
});

it('resets backoff after ready and resets the screen cursor only for a snapshot', () => {
  vi.useFakeTimers();
  const f = fixture(), stop = f.start();
  f.connections[0].fail();
  vi.advanceTimersByTime(1_000);
  f.connections[1].deliver({ event: 'ready', data: { id: 'terminal', resumed: false } });
  expect(f.position.after).toBeNull();
  f.connections[1].deliver({ event: 'data', data: 'snapshot', id: '20' });
  f.connections[1].fail();
  vi.advanceTimersByTime(1_000);
  expect(f.ws).toHaveBeenCalledTimes(3);
  expect(f.position.after).toBe(20);
  stop();
});

it.each(['exit', 'error'] as const)('does not reconnect a finished terminal (%s)', event => {
  vi.useFakeTimers();
  const f = fixture(), stop = f.start();
  f.connections[0].deliver(event === 'exit' ? { event, data: { code: 0, signal: null } } : { event, data: { message: 'gone' } });
  f.connections[0].fail();
  vi.advanceTimersByTime(60_000);
  expect(f.ws).toHaveBeenCalledOnce();
  stop();
});

it('keeps a worker outage on the existing feed until ready', () => {
  vi.useFakeTimers();
  const f = fixture(), stop = f.start();
  f.connections[0].deliver({ event: 'unavailable', data: { message: 'Device is away.' } });
  vi.advanceTimersByTime(60_000);
  expect(f.ws).toHaveBeenCalledOnce();
  f.connections[0].deliver({ event: 'ready', data: { id: 'terminal', resumed: true } });
  expect(f.listener).toHaveBeenLastCalledWith('ready', { id: 'terminal', resumed: true }, undefined);
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
  expect(f.connections[0].stop).toHaveBeenCalledOnce();
  f.connections[0].fail();
  vi.advanceTimersByTime(60_000);
  expect(f.ws).toHaveBeenCalledOnce();
  Object.defineProperty(doc, 'visibilityState', { value: 'visible', configurable: true });
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(f.ws).toHaveBeenCalledTimes(2);
  expect(f.position.after).toBe(5);
  stop();
});

it('does not open a socket for a screen initially hidden', () => {
  const f = fixture();
  f.env.document = { visibilityState: 'hidden', addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as Document;
  const stop = f.start();
  expect(f.ws).not.toHaveBeenCalled();
  stop();
});

it('cancels a subscription that fails synchronously during setup', () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const ws = vi.fn((_deliver, fail) => { fail(); return cancel; });
  const stop = subscribeTerminalOutput('/sessions/chat', 'terminal', { after: 5 }, vi.fn(), { ws, document: undefined });
  expect(cancel).toHaveBeenCalledOnce();
  stop();
  vi.advanceTimersByTime(60_000);
  expect(ws).toHaveBeenCalledOnce();
});
