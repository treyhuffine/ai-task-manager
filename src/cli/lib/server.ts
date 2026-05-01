/**
 * Spawn the Next server as a child process and wait for it to be ready.
 *
 * Uses `next start` (production mode). For local CLI iteration before a build
 * exists, pass `dev: true` to spawn `next dev` instead.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface StartServerOptions {
  port: number;
  dev?: boolean;
  /** When set, wrap the spawn in `portless <name> ...` so the dev server is
   *  reachable at `<name>.localhost`. Caller is responsible for verifying
   *  portless is installed (see `isPortlessInstalled`). */
  portlessName?: string;
}

export function startNextServer(opts: StartServerOptions): ChildProcess {
  const nextBin = require.resolve('next/dist/bin/next');
  const subcommand = opts.dev ? 'dev' : 'start';

  // Under portless: portless picks a random port (4000-4999) and injects it
  // via $PORT to the child. We must NOT override PORT or pass `-p` here, or
  // Next will bind to a port portless isn't proxying to → 502 at the static
  // hostname. Without portless: we own the port (allocated by start.ts) and
  // pass it explicitly so behavior matches `next dev --port 4224` directly.
  if (opts.portlessName) {
    return spawn(
      'portless',
      [opts.portlessName, process.execPath, nextBin, subcommand],
      { stdio: ['ignore', 'inherit', 'inherit'], env: process.env },
    );
  }

  return spawn(process.execPath, [nextBin, subcommand, '-p', String(opts.port)], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PORT: String(opts.port) },
  });
}

export function isPortlessInstalled(): boolean {
  return spawnSync('command', ['-v', 'portless'], {
    stdio: 'ignore',
    shell: true,
  }).status === 0;
}

export async function waitForServer(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const probe = await probeHealth(baseUrl);
    if (probe.status === 'ok') return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not respond at ${baseUrl} within ${timeoutMs}ms`);
}

/**
 * Confirms that *our* app is the thing listening at this base URL.
 * Relies on `/api/health` returning 200 with the expected app name —
 * any other process at that URL will either refuse connection, return
 * a non-200, or respond with a body that doesn't match.
 */
export async function isOurServerRunning(baseUrl: string): Promise<boolean> {
  return (await probeHealth(baseUrl)).status === 'ok';
}

export interface HealthInfo {
  ok: boolean;
  app: string;
  port: number;
}

export type HealthProbe =
  | { status: 'ok'; info: HealthInfo }
  | { status: 'offline' }
  | { status: 'unreachable'; detail: string }
  | { status: 'unknown-app'; detail: string };

/**
 * Probe `/api/health` at a given base URL.
 *
 * Accepts either `http://localhost:4224` or `https://flow.localhost` — the
 * latter is used when the dev server is fronted by a static-hostname proxy
 * (portless.sh, caddy, etc.) and the underlying port is allocated by the
 * proxy rather than known to us.
 *
 * Timeout is generous (10s) because the Next dev server compiles routes
 * lazily — a cold first hit to `/api/health` often takes several seconds.
 * `/api/health` is unauthenticated, so no token is required.
 */
export async function probeHealth(baseUrl: string): Promise<HealthProbe> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // 502/503/504 from a reverse proxy means the proxy is up but our
      // backend hasn't bound yet — treat as offline so callers retry.
      if (res.status >= 502 && res.status <= 504) return { status: 'offline' };
      return { status: 'unknown-app', detail: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as Partial<HealthInfo>;
    if (typeof body.port !== 'number' || typeof body.app !== 'string') {
      return { status: 'unknown-app', detail: 'health response missing fields' };
    }
    return { status: 'ok', info: { ok: body.ok ?? true, app: body.app, port: body.port } };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Connection-refused / DNS / TLS errors all mean "nothing answering" —
    // surface as offline so polling loops know to retry rather than abort.
    if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(detail)) {
      return { status: 'offline' };
    }
    return { status: 'unreachable', detail };
  }
}
