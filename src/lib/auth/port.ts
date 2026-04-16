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
 *   3. DEFAULT_PORT
 */

import { readAuthConfig, writeAuthConfig } from '@/lib/auth/config-file';

export const DEFAULT_PORT = 4224;

export function getRunningPort(): number {
  const env = process.env.PORT;
  if (env && Number.isFinite(Number(env))) return Number(env);
  const saved = readAuthConfig()?.lastPort;
  if (saved && Number.isFinite(saved)) return saved;
  return DEFAULT_PORT;
}

export function setRunningPort(port: number): void {
  writeAuthConfig({ lastPort: port });
}
