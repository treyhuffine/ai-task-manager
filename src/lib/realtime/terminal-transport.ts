import { pageStream, type TerminalPosition } from './page-stream';
import { trpcClient } from '@/lib/trpc/client';
import { getTransportMode, getTransportStatus, subscribeTransport } from '@/lib/trpc/transport-state';
import type { TerminalFrame } from '@/lib/trpc/terminal-subscription';

/** One screen keeps its delivered cursor across WS/SSE switches. Chats and
 * global events continue on the multiplexed page stream in either mode. */
export function subscribeTerminalOutput(
  base: string, terminalId: string, position: TerminalPosition,
  listener: (event: string, data: unknown, id?: string) => void,
  env = {
    getMode: getTransportMode,
    getStatus: getTransportStatus,
    subscribe: subscribeTransport,
    sse: (deliver: typeof listener) => pageStream().subscribeTerminal(base, terminalId, position, deliver),
    ws: (deliver: (frame: TerminalFrame) => void, fail: () => void) => {
      const subscription = trpcClient.terminals.output.subscribe({ base, terminalId, after: position.after }, {
        onData: frame => deliver(frame.data), onError: fail,
      });
      return () => subscription.unsubscribe();
    },
    document: typeof document === 'undefined' ? undefined : document,
  },
): () => void {
  let stop = () => {};
  let current: 'ws' | 'sse' | 'hidden' | undefined;
  let disposed = false;
  let failed = false;
  let previousState: string | undefined;
  let epoch = 0;
  let released = env.document?.visibilityState === 'hidden';
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  const switchTransport = () => {
    if (disposed) return;
    const status = env.getStatus().state;
    if (status === 'websocket' && status !== previousState) failed = false;
    previousState = status;
    const target = released ? 'hidden' : env.getMode() === 'websocket' && status === 'websocket' && !failed ? 'ws' : 'sse';
    if (target === current) return;
    current = target;
    const version = ++epoch;
    stop();
    stop = () => {};
    if (target === 'hidden') return;
    // SSE marks refer to a specific page connection. WS frames invalidate
    // that mark, so rejoining SSE must open from this screen's current cursor.
    if (target === 'ws') {
      delete position.mark;
      stop = env.ws(frame => {
        if (disposed || epoch !== version) return;
        if (frame.id !== undefined && /^\d+$/.test(frame.id)) position.after = Number(frame.id);
        else if (frame.event === 'ready' && !frame.data.resumed) position.after = null;
        listener(frame.event, frame.data, frame.id);
      }, () => { if (!disposed && epoch === version) { failed = true; current = undefined; switchTransport(); } });
    } else stop = env.sse((event, data, id) => { if (!disposed && epoch === version) listener(event, data, id); });
  };
  const visibility = () => {
    if (env.document?.visibilityState === 'hidden') {
      if (hiddenTimer || released) return;
      hiddenTimer = setTimeout(() => { hiddenTimer = undefined; released = true; switchTransport(); }, 5_000);
    } else {
      if (hiddenTimer) clearTimeout(hiddenTimer);
      hiddenTimer = undefined;
      released = false;
      switchTransport();
    }
  };
  const unwatch = env.subscribe(switchTransport);
  env.document?.addEventListener('visibilitychange', visibility);
  switchTransport();
  return () => {
    disposed = true;
    epoch++;
    if (hiddenTimer) clearTimeout(hiddenTimer);
    unwatch();
    env.document?.removeEventListener('visibilitychange', visibility);
    stop();
  };
}
