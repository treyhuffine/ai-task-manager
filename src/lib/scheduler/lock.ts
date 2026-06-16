/**
 * File-based scheduler lock. Single Node process, single tick — but we
 * still grab a lock per tick body so two concurrent `setInterval` fires
 * (an unexpectedly slow previous tick + a new one starting on time)
 * don't both dispatch the same `next_run_at`-due row.
 *
 * Implementation: `O_CREAT|O_WRONLY|O_EXCL` open (Node's `'wx'` flag)
 * fails fast when another holder still has the file. The lock holder
 * writes its pid for diagnostics; the file is unlinked on release. A
 * stale lock (process crash mid-tick) is detected by the watchdog
 * helper below — `tryAcquire` does not stat or kill, so a healthy
 * second tick during a long-running one just bails out cleanly.
 *
 * Not a cluster-wide primitive. Multi-process scheduling would need a
 * DB-backed advisory lock; intentionally out of V1 scope.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getWorkDir, ensureWorkDir } from '@/lib/config/paths';

export interface SchedulerLock {
  /** Absolute path of the lock file. Useful for diagnostics. */
  filePath: string;
  /** Owning pid recorded in the file at acquire. */
  pid: number;
}

/**
 * Best-effort read of the pid currently holding the lock. Returns null
 * when the file is missing or unreadable. Used for diagnostic logging
 * when `acquireSchedulerLock` returns null — knowing who holds it is
 * the difference between "expected single-process behavior" and
 * "another instance is racing."
 */
export function peekLockHolderPid(): number | null {
  try {
    const raw = fs.readFileSync(lockPath(), 'utf8').trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Synchronous unlink keyed by pid. Safe to call from a SIGTERM /
 * `process.on('exit')` handler — does not await fs and does not throw.
 * Used by `installSchedulerShutdownHook` so an orderly stop leaves no
 * stale lock for the 5-minute window to clean up.
 */
export function releaseLockIfOwnedSync(pid: number = process.pid): void {
  try {
    const onDisk = fs.readFileSync(lockPath(), 'utf8').trim();
    if (onDisk !== String(pid)) return;
    fs.unlinkSync(lockPath());
  } catch {
    // ENOENT / unreadable — nothing to do.
  }
}

const LOCK_FILE_NAME = '.scheduler.lock';
/** A lock older than this is presumed dead. Tick interval is 60s. */
const STALE_LOCK_MAX_AGE_MS = 5 * 60_000;

function lockPath(): string {
  // Runtime state → .work (not the synced home; a stale lock shouldn't sync).
  return path.join(getWorkDir(), LOCK_FILE_NAME);
}

/**
 * Try to take the lock. Returns null if another process/tick holds it.
 *
 * Concurrent-acquire safety: `wx` mode is atomic in the OS — exactly
 * one of N simultaneous attempts succeeds. The loser does not retry.
 */
export function acquireSchedulerLock(): SchedulerLock | null {
  ensureWorkDir();
  const filePath = lockPath();
  // Stale-lock sweep: if the file is older than STALE_LOCK_MAX_AGE_MS,
  // its writer almost certainly crashed (or got killed) without
  // releasing. Clear it before the open so a healthy tick can proceed.
  try {
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > STALE_LOCK_MAX_AGE_MS) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ENOENT — no existing lock, normal happy path.
  }
  try {
    const fd = fs.openSync(filePath, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return { filePath, pid: process.pid };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return null;
    // Surface anything else — disk full, permissions, etc.
    throw err;
  }
}

/**
 * Release the lock. Idempotent — caller may release twice without
 * surfacing an error. Only unlinks when the file still belongs to this
 * holder (pid matches), so a stale sweep that ran in a different
 * process can't be undone.
 */
export function releaseSchedulerLock(lock: SchedulerLock): void {
  try {
    const onDisk = fs.readFileSync(lock.filePath, 'utf8').trim();
    if (onDisk !== String(lock.pid)) return;
    fs.unlinkSync(lock.filePath);
  } catch {
    // ENOENT or empty read — nothing to clean. Done.
  }
}
