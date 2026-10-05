import type { TerminalPosition } from './page-stream';
import { terminalTRPCClient } from '@/lib/trpc/client';
import type { TerminalFrame } from '@/lib/trpc/terminal-subscription';

/** Terminal traffic has its own WS connection, independent of the API preference.
 * Reconnect from output delivered to this screen, never from queued frames. */
export function subscribeTerminalOutput(
  base: string, terminalId: string, position: TerminalPosition,
  listener: (event: string, data: unknown, id?: string) => void,
  env = {
    ws: (deliver: (frame: TerminalFrame) => void, fail: () => void) => {
      const subscription = terminalTRPCClient.terminals.output.subscribe({ base, terminalId, after: position.after }, {
        onData: frame => deliver(frame.data), onError: fail, onComplete: fail,
      });
      return () => subscription.unsubscribe();
    },
    document: typeof document === 'undefined' ? undefined : document,
  },
): () => void {
  let stop = () => {};
  let disposed = false;
  let finished = false;
  let epoch = 0;
  let failures = 0;
  let released = env.document?.visibilityState === 'hidden';
  let retry: ReturnType<typeof setTimeout> | undefined;
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  delete position.mark;

  const disconnect = () => {
    epoch++;
    if (retry) clearTimeout(retry);
    retry = undefined;
    stop();
    stop = () => {};
  };
  const connect = () => {
    if (disposed || finished || released) return;
    disconnect();
    const version = epoch;
    listener('unavailable', { message: 'Connecting to the terminal WebSocket.' });
    const cancel = env.ws(frame => {
      if (disposed || epoch !== version) return;
      if (frame.id !== undefined && /^\d+$/.test(frame.id)) position.after = Number(frame.id);
      else if (frame.event === 'ready' && !frame.data.resumed) position.after = null;
      if (frame.event === 'ready') failures = 0;
      if (frame.event === 'exit' || frame.event === 'error') finished = true;
      listener(frame.event, frame.data, frame.id);
    }, () => {
      if (disposed || finished || epoch !== version) return;
      disconnect();
      listener('unavailable', { message: 'The terminal WebSocket is disconnected. Reconnecting.' });
      if (!released) {
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(failures++, 5));
        retry = setTimeout(() => { retry = undefined; connect(); }, delay);
      }
    });
    // Subscription callbacks can run during setup, before its cancel handle exists.
    if (disposed || epoch !== version) cancel();
    else stop = cancel;
  };
  const visibility = () => {
    if (env.document?.visibilityState === 'hidden') {
      if (hiddenTimer || released) return;
      hiddenTimer = setTimeout(() => {
        hiddenTimer = undefined;
        released = true;
        disconnect();
        if (!disposed && !finished) listener('unavailable', { message: 'The terminal reconnects when this view is visible.' });
      }, 5_000);
    } else {
      if (hiddenTimer) clearTimeout(hiddenTimer);
      hiddenTimer = undefined;
      if (released) {
        released = false;
        failures = 0;
        connect();
      }
    }
  };
  env.document?.addEventListener('visibilitychange', visibility);
  connect();
  return () => {
    disposed = true;
    if (hiddenTimer) clearTimeout(hiddenTimer);
    env.document?.removeEventListener('visibilitychange', visibility);
    disconnect();
  };
}
