/**
 * Running-port discovery.
 *
 * Kept in its own module (no DB / auth deps) so lightweight consumers like
 * `/api/health` don't have to pull in the entire auth stack to answer
 * "what port am I on?"
 *
 * Resolution order:
 *   1. $PORT            — set when running inside the `start` process
 *   2. config.lastPort  — written by `start` at boot so out-of-process
 *                         commands (e.g. `pair`) know the right port
 *   3. fallback         — DEFAULT_PORT unless the caller passes another (e.g.
 *                         `stop --dev` passes DEV_PORT for a `pnpm dev` server
 *                         that never persisted a lastPort)
 */

import { readAuthConfig, writeAuthConfig } from '@/lib/auth/config-file';

export const DEFAULT_PORT = 4224;

/**
 * Default port for dev instances (`pnpm dev`, `flow start --dev`). Deliberately
 * distinct from {@link DEFAULT_PORT} so a dev server and a production server can
 * run side by side without fighting over 4224. Kept in sync with the `dev`
 * scripts in package.json (which can't import this constant from a shell).
 */
export const DEV_PORT = 42241;

export function getRunningPort(fallback: number = DEFAULT_PORT): number {
  const env = process.env.PORT;
  if (env && Number.isFinite(Number(env))) return Number(env);
  const saved = readAuthConfig()?.lastPort;
  if (saved && Number.isFinite(saved)) return saved;
  return fallback;
}

export function setRunningPort(port: number): void {
  writeAuthConfig({ lastPort: port });
}
