/**
 * Cross-process `Lock` (§9). This repo runs the CLI and the dev server against
 * one home, so an in-process mutex does not span them — a token rotation in one
 * process could corrupt a concurrent read/write in the other. `mkdir` is atomic
 * across processes (EEXIST if held), so it makes a dependency-free advisory lock.
 * Latent for the first slice (Google preserves refresh tokens), real the moment a
 * rotating-refresh-token provider lands — hence the local default with `fileStore`.
 */
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Lock } from '../core/types';
import { inProcessLock } from './in-process';

export interface FileLockOptions {
  /** Directory to hold `<key>.lock` markers. */
  dir: string;
  /** A lock older than this is treated as abandoned and broken (default 30s). */
  staleMs?: number;
  /** Poll interval while waiting (default 25ms). */
  retryMs?: number;
  /** Give up acquiring after this long (default 15s). */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function fileLock(opts: FileLockOptions): Lock {
  const staleMs = opts.staleMs ?? 30_000;
  const retryMs = opts.retryMs ?? 25;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const local = inProcessLock(); // also serialize same-process callers (no busy spin)

  const lockPath = (key: string) => join(opts.dir, `${encodeURIComponent(key)}.lock`);

  async function acquire(path: string): Promise<void> {
    const start = Date.now();
    for (;;) {
      try {
        await mkdir(path, { recursive: false });
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code !== 'EEXIST') throw e;
        try {
          const s = await stat(path);
          if (Date.now() - s.mtimeMs > staleMs) {
            await rm(path, { recursive: true, force: true });
            continue;
          }
        } catch {
          continue; // lock vanished between EEXIST and stat → retry immediately
        }
        if (Date.now() - start > timeoutMs) throw new Error(`fileLock: timed out acquiring ${path}`);
        await sleep(retryMs);
      }
    }
  }

  return {
    async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
      return local.withLock(key, async () => {
        await mkdir(opts.dir, { recursive: true });
        const path = lockPath(key);
        await acquire(path);
        try {
          return await fn();
        } finally {
          await rm(path, { recursive: true, force: true }).catch(() => undefined);
        }
      });
    },
  };
}
