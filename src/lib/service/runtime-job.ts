import path from 'node:path';
import { fork } from 'node:child_process';
import { establishRuntimeJobOwner, type RuntimeJobOwner } from './runtime-job-owner';

let owner: RuntimeJobOwner | undefined;
let stopping = false;
const active = new Set<{ stop: (graceMs: number) => void; closed: Promise<void> }>();

/** Startup must fence orphaned helpers before it opens or restores the DB. */
export async function initializeRuntimeJobs() {
  const deadline = Date.now() + 30_000;
  while (true) {
    if (stopping) throw new Error('The service is stopping');
    try { owner = establishRuntimeJobOwner(); return; }
    catch (error) {
      if ((error as { code?: string }).code !== 'SQLITE_BUSY') throw error;
      if (Date.now() >= deadline) throw new Error('A previous runtime job still owns the database. Wait for it to exit before restarting.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

/** Close admission before killing helpers, and retain service ownership until
 * every child is reaped. Failed/aborted jobs cannot keep mutating in the back. */
export async function stopRuntimeJobs(graceMs = 5000) {
  stopping = true;
  const jobs = [...active];
  for (const job of jobs) job.stop(graceMs);
  await Promise.all(jobs.map(job => job.closed));
}

/** Heavy filesystem/hash work must never freeze the controller's status and
 * ownership surface. The helper uses the controller's trusted runtime/ABI. */
export function runtimeJob<T>(repo: string, action: 'verify' | 'download' | 'checkpoint' | 'restore' | 'validate-database', value: unknown, progress?: (bytes: number) => void, node = process.execPath): Promise<T> {
  if (!owner || stopping) return Promise.reject(new Error('Runtime jobs are unavailable while the service is starting or stopping'));
  return new Promise((resolve, reject) => {
    const child = fork(path.join(repo, 'dist/service/runtime-job.cjs'), [], { execPath: node, execArgv: [], cwd: repo, env: process.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let outcome: { error?: Error; value?: T } | undefined;
    let force: ReturnType<typeof setTimeout> | undefined;
    let reaped!: () => void;
    const stop = (error: Error, graceMs = 5000) => {
      outcome = { error };
      child.kill('SIGTERM');
      force ??= setTimeout(() => child.kill('SIGKILL'), graceMs);
    };
    const job = {
      stop: (graceMs: number) => stop(new Error('The service stopped this runtime job'), graceMs),
      closed: new Promise<void>(resolve => { reaped = resolve; }),
    };
    active.add(job);
    const timer = setTimeout(() => stop(new Error(`Runtime ${action} exceeded its one-hour limit`)), 60 * 60_000);
    child.on('error', error => stop(error));
    child.stderr?.resume(); // no credentials or dependency diagnostics forwarded
    child.on('message', (message: { type?: string; bytes?: number; value?: T; error?: string }) => {
      if (message.type === 'progress' && Number.isFinite(message.bytes)) {
        try { progress?.(message.bytes!); }
        catch (error) { stop(error instanceof Error ? error : new Error('Could not record update progress')); }
      }
      if (!outcome && message.type === 'result') outcome = { value: message.value };
      if (message.type === 'error') stop(new Error(message.error ?? `Runtime ${action} failed`));
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(force); active.delete(job); reaped();
      if (outcome?.error) reject(outcome.error);
      else if (outcome && code === 0) resolve(outcome.value as T);
      else reject(new Error(`Runtime ${action} helper exited (${signal ?? code})`));
    });
    child.send({ action, value, owner }, error => { if (error) stop(error); });
  });
}
