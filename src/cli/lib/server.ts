/**
 * Spawn the Next server as a child process and wait for it to be ready.
 *
 * Uses `next start` (production mode). For local CLI iteration before a build
 * exists, pass `dev: true` to spawn `next dev` instead.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface StartServerOptions {
  port: number;
  dev?: boolean;
}

export function startNextServer(opts: StartServerOptions): ChildProcess {
  const nextBin = require.resolve('next/dist/bin/next');
  const subcommand = opts.dev ? 'dev' : 'start';

  return spawn(process.execPath, [nextBin, subcommand, '-p', String(opts.port)], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PORT: String(opts.port) },
  });
}

export async function waitForServer(port: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await canConnect(port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not start on port ${port} within ${timeoutMs}ms`);
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Confirms that *our* app is the thing listening on this port.
 * Relies on `/api/health` returning 200 when the bearer token is valid —
 * any other process on the port will either refuse connection or 401.
 */
export async function isOurServerRunning(port: number, token: string): Promise<boolean> {
  return (await probeHealth(port, token)).status === 'ok';
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
  | { status: 'unauthorized'; httpStatus: number }
  | { status: 'unknown-app'; detail: string };

/**
 * Probe `/api/health` on a given port.
 *
 * Timeout is generous (10s) because the Next dev server compiles routes
 * lazily — a cold first hit to `/api/health` often takes several seconds.
 */
export async function probeHealth(port: number, token: string): Promise<HealthProbe> {
  if (!(await canConnect(port))) return { status: 'offline' };
  try {
    // Use 127.0.0.1 (not `localhost`) to match canConnect() above — some
    // macOS / dual-stack setups resolve `localhost` to `::1` first, which
    // would fail when the Next server binds IPv4-only.
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) {
      return { status: 'unauthorized', httpStatus: res.status };
    }
    if (!res.ok) {
      return { status: 'unknown-app', detail: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as Partial<HealthInfo>;
    if (typeof body.port !== 'number' || typeof body.app !== 'string') {
      return { status: 'unknown-app', detail: 'health response missing fields' };
    }
    return { status: 'ok', info: { ok: body.ok ?? true, app: body.app, port: body.port } };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { status: 'unreachable', detail };
  }
}
