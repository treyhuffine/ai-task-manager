import { afterEach, expect, it, vi } from 'vitest';
import type { TerminalListener } from './pty-manager';
const manager = vi.hoisted(() => ({ subscribe: vi.fn(), createTerminal: vi.fn(), getTerminal: vi.fn(), killTerminal: vi.fn(), listTerminals: vi.fn(), resizeTerminal: vi.fn(), writeInput: vi.fn() }));
vi.mock('./pty-manager', () => manager);
import { terminalStreamResponse } from './http';
afterEach(() => { vi.useRealTimers(); manager.subscribe.mockReset(); });

it('releases the listener and heartbeat when the PTY exits without waiting for reader cancellation', async () => {
  vi.useFakeTimers();
  let listener: TerminalListener = () => {};
  const unsubscribe = vi.fn();
  manager.subscribe.mockImplementation((_owner, _id, callback: TerminalListener) => {
    listener = callback;
    return { unsubscribe, replay: '', offset: 0, gap: false, exited: false, exitCode: null };
  });
  const response = terminalStreamResponse(new Request('http://local/stream'), () => ({ ok: true, ownerId: 'owner', cwd: '/tmp' }), 'terminal');
  const reader = response.body!.getReader();
  await reader.read();
  expect(vi.getTimerCount()).toBe(1);
  listener({ type: 'exit', code: 0, signal: null });
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  await reader.read();
  expect((await reader.read()).done).toBe(true);
});

it('releases a live terminal when the WS feed cancels its reader', async () => {
  vi.useFakeTimers();
  const unsubscribe = vi.fn();
  manager.subscribe.mockReturnValue({ unsubscribe, replay: '', offset: 0, gap: false, exited: false, exitCode: null });
  const response = terminalStreamResponse(new Request('http://local/stream'), () => ({ ok: true, ownerId: 'owner', cwd: '/tmp' }), 'terminal');
  await response.body!.getReader().cancel();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
