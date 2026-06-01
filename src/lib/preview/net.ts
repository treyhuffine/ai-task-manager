/**
 * Low-level TCP helpers for deterministic preview port handling.
 *
 *   - `allocatePort()` grabs a currently-free port (bind `:0`, read it,
 *     release). We persist the result as the worktree's *stable* port so
 *     restarts reuse it → the tunnel URL stays stable.
 *   - `isPortListening()` / `confirmListening()` replace the fragile
 *     stdout-scrape as the *primary* signal: we don't trust that the dev
 *     server printed a port, we prove the port actually accepts a
 *     connection before marking the preview `running` (and before pointing
 *     a tunnel at it — a tunnel to a dead port is a useless URL).
 *
 * The brief bind-:0 race (another process could grab the port between
 * release and the child binding it) is caught by confirm-listening: if the
 * child never comes up on its assigned port, the supervisor surfaces a
 * clear no-port status instead of hanging.
 */

import net from 'node:net';

/** Grab a currently-free TCP port by binding `:0` on loopback. */
export function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object' && typeof addr.port === 'number') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('allocatePort: could not read assigned port')));
      }
    });
  });
}

/** Is something accepting TCP connections on `127.0.0.1:<port>` right now? */
export function isPortListening(port: number, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port <= 0) {
      resolve(false);
      return;
    }
    const sock = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(value);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

export interface ConfirmListeningOptions {
  /** Give up after this long. Default 30s. */
  timeoutMs?: number;
  /** Delay between poll rounds. Default 250ms. */
  intervalMs?: number;
  /** Bail immediately when aborted (e.g. a Stop arrives mid-confirm). */
  signal?: AbortSignal;
}

/**
 * Poll until one of the candidate ports accepts a connection, or timeout.
 * Returns the first reachable port, or null on timeout/abort.
 *
 * `ports` may be a function so a dynamically-discovered port (the stdout
 * `PortDetector` fallback, for an app that ignores `$PORT` and opens a
 * different one) gets folded into the candidate set on each round.
 */
export async function confirmListening(
  ports: number[] | (() => number[]),
  opts: ConfirmListeningOptions = {},
): Promise<number | null> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 250;
  const getPorts = typeof ports === 'function' ? ports : () => ports;
  const deadline = Date.now() + timeoutMs;

  const probe = async (): Promise<number | null> => {
    const candidates = [...new Set(getPorts().filter((p) => Number.isInteger(p) && p > 0))];
    for (const p of candidates) {
      if (opts.signal?.aborted) return null;
      if (await isPortListening(p, Math.min(1_000, intervalMs * 4))) return p;
    }
    return null;
  };

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return null;
    const found = await probe();
    if (found !== null) return found;
    await delay(intervalMs, opts.signal);
  }
  // One final probe so a server that came up right at the deadline isn't missed.
  return opts.signal?.aborted ? null : probe();
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
