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
  if (!(await canConnect(port))) return false;
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
