/**
 * Managed-instance discovery + ownership record.
 *
 * One generic runtime record per data root, written by `flow start` after the
 * public listener is confirmed healthy and read by out-of-process commands
 * (`pair`, `stop`, health/URL helpers) that need to know *where* and *how* the
 * running instance is reachable. It is deliberately NOT a user settings store:
 * it describes the live process, not a saved preference.
 *
 * Design rules (see docs/optional-http2.md §5/§6):
 *   - Lives under `getWorkDir()` (regenerable scratch), NEVER `.config`. A stale
 *     record is disposable — the launcher republishes on every managed start.
 *   - Contains NO auth token and NO TLS private key. Only public routing facts.
 *   - Published atomically (temp + rename) and only AFTER readiness, so a failed
 *     start never replaces a live instance's discovery state.
 *   - A record alone is not proof of a live process. Callers acting on it must
 *     verify launcher liveness (`isRecordLive`) before treating it as running.
 *   - Cleared on shutdown only when the run ID still belongs to the stopping
 *     instance, so an old handler can't erase a newer instance's record.
 */

import fs from 'node:fs';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { getWorkDir, ensureWorkDir } from '@/lib/config/paths';

/**
 * Launcher-set public base URL for the CURRENT process. The launcher exports
 * this into its own environment and into the Next child so both report the
 * canonical public origin instead of Next's private listening address (Next
 * overwrites `process.env.PORT` with its private port, so `PORT` alone is
 * insufficient). Highest-precedence input to `getLocalBaseUrl()`.
 */
export const PUBLIC_BASE_URL_ENV = 'FLOW_PUBLIC_BASE_URL';

/** Deployment mode of the public listener. `https` implies the HTTP/2 gateway. */
export type ServerRuntimeMode = 'http' | 'https';

export interface ServerRuntimeRecord {
  version: 1;
  /** Unique per managed launch. Ownership key for cleanup. */
  runId: string;
  /** PID of the `flow start` launcher process that owns the listener chain. */
  launcherPid: number;
  /** ISO timestamp of publication (after readiness). */
  startedAt: string;
  /** `https` when the HTTP/2 gateway fronts the public port, else `http`. */
  mode: ServerRuntimeMode;
  /** Whether HTTP/2 is offered on the public listener. */
  http2: boolean;
  /** Canonical public origin, e.g. `https://localhost:4224`. No trailing slash. */
  publicBaseUrl: string;
  /** Public port the listener is bound to. */
  publicPort: number;
  /** Owned private loopback upstream addresses. Never client-derived. */
  privateUpstreams: {
    /** The Next server, e.g. `http://127.0.0.1:53411`. */
    next: string;
    /** Reserved for the independent realtime (WebSocket) gateway, when present. */
    realtime?: string;
  };
}

export function getServerRuntimePath(): string {
  return path.join(getWorkDir(), 'server-runtime.json');
}

/** True if `pid` is a live process this user can signal. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 performs error checking without delivering a signal.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but is owned by another user — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isValidRecord(value: unknown): value is ServerRuntimeRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<ServerRuntimeRecord>;
  return (
    r.version === 1 &&
    typeof r.runId === 'string' &&
    typeof r.launcherPid === 'number' &&
    typeof r.startedAt === 'string' &&
    (r.mode === 'http' || r.mode === 'https') &&
    typeof r.http2 === 'boolean' &&
    typeof r.publicBaseUrl === 'string' &&
    typeof r.publicPort === 'number' &&
    !!r.privateUpstreams &&
    typeof r.privateUpstreams.next === 'string'
  );
}

/** Read the record for the active data root, or null if missing/unparseable/invalid. */
export function readServerRuntime(): ServerRuntimeRecord | null {
  const p = getServerRuntimePath();
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return null; // ENOENT is the common case — no managed instance recorded.
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isValidRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read the record ONLY if its launcher process is still alive. Returns null for
 * a missing, invalid, or dead-instance record — so a URL record alone never
 * masquerades as a running server. Callers that also need to health-check the
 * listener should do so on top of this.
 */
export function readLiveServerRuntime(): ServerRuntimeRecord | null {
  const record = readServerRuntime();
  if (!record) return null;
  return isProcessAlive(record.launcherPid) ? record : null;
}

/**
 * Atomically publish the record. Call only after the public listener is
 * confirmed ready — publishing earlier would let a failed start clobber a live
 * instance's discovery state. Write to a temp file in the same directory and
 * rename over the target (atomic on the same filesystem).
 */
export function publishServerRuntime(record: ServerRuntimeRecord): void {
  ensureWorkDir();
  const target = getServerRuntimePath();
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, target);
}

/**
 * Remove the record ONLY when it still belongs to `runId`. A newer instance may
 * have replaced the file since this launcher started; erasing it then would
 * strand the live instance's discovery state, so we no-op in that case.
 */
export function clearServerRuntimeIfOwned(runId: string): void {
  const current = readServerRuntime();
  if (!current || current.runId !== runId) return;
  try {
    fs.unlinkSync(getServerRuntimePath());
  } catch {
    // Already gone — nothing to do.
  }
}

/** Mint a fresh run ID for a managed launch. */
export function newRunId(): string {
  return uuidv7();
}
