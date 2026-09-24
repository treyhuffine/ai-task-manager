/**
 * The home's own key: the one `ensureLocalToken` minted at startup and keeps
 * in this root's config (`localToken`). Holding it is what makes a caller
 * the home's own machine: the local CLI, and the harness sessions the home
 * runs, which carry it in their orchestrator config. A device's `deviceType`
 * label never decides this, because any paired device can edit its label.
 *
 * The hash is cached against the config file's modification time, so the
 * proxy can check every request without reading the file each time.
 */

import fs from 'node:fs';
import { getConfigPath } from '@/lib/config/paths';
import { hashToken } from './tokens';

let cache: { path: string; mtimeMs: number; hash: string | null } | null = null;

export function hostKeyHash(): string | null {
  const file = getConfigPath();
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    cache = null;
    return null;
  }
  if (cache && cache.path === file && cache.mtimeMs === mtimeMs) return cache.hash;
  let hash: string | null = null;
  try {
    const token = (JSON.parse(fs.readFileSync(file, 'utf8')) as { localToken?: string | null }).localToken;
    hash = token ? hashToken(token) : null;
  } catch {
    hash = null;
  }
  cache = { path: file, mtimeMs, hash };
  return hash;
}

/** Whether a validated token's hash is the home's own key. */
export function isHostKeyHash(tokenHash: string): boolean {
  const host = hostKeyHash();
  return host !== null && host === tokenHash;
}
