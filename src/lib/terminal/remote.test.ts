/**
 * The home's relay of a terminal on another computer (P3.5): a viewer gets
 * the replay, then output spliced on by offset, whatever arrived while the
 * replay was on its way. Output out of step ends the stream so its
 * reconnect catches up, and another computer can't write into it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestWorker = vi.fn();
vi.mock('@/lib/workers/hub', () => ({
  requestWorker: (...args: unknown[]) => requestWorker(...args),
  WorkerUnavailableError: class WorkerUnavailableError extends Error {},
  WorkerRequestError: class WorkerRequestError extends Error {
    unsupported = false;
  },
}));

import { _resetRemoteTerminals, computerTerminalsGone, deliverTerminalOutput, remoteTerminalStream } from './remote';

const place = { computerId: 'laptop', computerName: 'MacBook', scope: { kind: 'execution' as const, executionId: 'e1', generation: 1 } };

function open(since?: number) {
  const res = remoteTerminalStream(new Request('http://x', { headers: since === undefined ? {} : { 'last-event-id': String(since) } }), place, 't1');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: Array<{ event: string; data: unknown; id?: string }> = [];
  let buffer = '';
  let closed = false;
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const lines = buffer.slice(0, at).split('\n');
        buffer = buffer.slice(at + 2);
        const event = lines.find((l) => l.startsWith('event: '))?.slice(7);
        const data = lines.find((l) => l.startsWith('data: '))?.slice(6);
        const id = lines.find((l) => l.startsWith('id: '))?.slice(4);
        if (event && data !== undefined) events.push({ event, data: JSON.parse(data), id });
      }
    }
    closed = true;
  })();
  return { events, closed: () => closed, cancel: () => reader.cancel() };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

function replayLater() {
  let answer!: (value: unknown) => void;
  requestWorker.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
  return (value: unknown) => answer(value);
}

beforeEach(() => {
  requestWorker.mockReset();
  _resetRemoteTerminals();
});

describe('a remote terminal stream', () => {
  it('splices what arrived during the replay on after it, then live output', async () => {
    const reply = replayLater();
    const view = open();
    await tick();
    deliverTerminalOutput('laptop', { chunks: [{ terminalId: 't1', data: '89AB', offset: 12 }], exits: [] });
    reply({ status: 200, body: { replay: '0123456789', offset: 10, gap: false, exited: false, exitCode: null } });
    await tick();
    deliverTerminalOutput('laptop', { chunks: [{ terminalId: 't1', data: 'CD', offset: 14 }], exits: [] });
    await tick();
    expect(view.events).toEqual([
      { event: 'ready', data: { id: 't1', resumed: false } },
      { event: 'data', data: '0123456789', id: '10' },
      { event: 'data', data: 'AB', id: '12' },
      { event: 'data', data: 'CD', id: '14' },
    ]);
    expect(requestWorker).toHaveBeenCalledWith('laptop', 'terminal', { op: 'replay', scope: place.scope, terminalId: 't1', since: undefined });
    await view.cancel();
  });

  it('ends the stream on output it can not splice, for the reconnect to catch up', async () => {
    requestWorker.mockResolvedValueOnce({ status: 200, body: { replay: '', offset: 10, gap: false, exited: false, exitCode: null } });
    const view = open(10);
    await tick();
    deliverTerminalOutput('laptop', { chunks: [{ terminalId: 't1', data: 'XY', offset: 20 }], exits: [] });
    await tick();
    expect(view.events).toEqual([{ event: 'ready', data: { id: 't1', resumed: true } }]);
    expect(view.closed()).toBe(true);
  });

  it("ignores output from another computer, and says when its own computer drops", async () => {
    requestWorker.mockResolvedValueOnce({ status: 200, body: { replay: 'hi', offset: 2, gap: false, exited: false, exitCode: null } });
    const view = open();
    await tick();
    deliverTerminalOutput('desktop', { chunks: [{ terminalId: 't1', data: 'evil', offset: 6 }], exits: [{ terminalId: 't1', code: 0, signal: null }] });
    await tick();
    computerTerminalsGone('laptop', 'MacBook');
    await tick();
    expect(view.events.map((e) => e.event)).toEqual(['ready', 'data', 'unavailable']);
    expect(view.closed()).toBe(true);
  });

  it('says a shell that ended while the replay was on its way ended, and one that is gone there is gone', async () => {
    const reply = replayLater();
    const view = open();
    await tick();
    deliverTerminalOutput('laptop', { chunks: [], exits: [{ terminalId: 't1', code: 0, signal: null }] });
    reply({ status: 200, body: { replay: 'bye', offset: 3, gap: false, exited: false, exitCode: null } });
    await tick();
    expect(view.events.map((e) => [e.event, e.data])).toEqual([
      ['ready', { id: 't1', resumed: false }],
      ['data', 'bye'],
      ['exit', { code: 0, signal: null }],
    ]);

    requestWorker.mockResolvedValueOnce({ status: 404, body: { error: 'Terminal not found' } });
    const gone = open();
    await tick();
    expect(gone.events).toEqual([{ event: 'exit', data: { code: null, signal: null, gone: true } }]);
  });
});
