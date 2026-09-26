import path from 'node:path';
import { fork } from 'node:child_process';

/** Heavy filesystem/hash work must never freeze the controller's status and
 * ownership surface. The helper uses the controller's trusted runtime/ABI. */
export function runtimeJob<T>(repo: string, action: 'verify' | 'download' | 'checkpoint' | 'restore' | 'validate-database', value: unknown, progress?: (bytes: number) => void, node = process.execPath): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(repo, 'dist/service/runtime-job.cjs'), [], { execPath: node, execArgv: [], cwd: repo, env: process.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let settled = false;
    const finish = (error?: Error, result?: T) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) { child.kill('SIGTERM'); reject(error); } else resolve(result as T);
    };
    const timer = setTimeout(() => finish(new Error(`Runtime ${action} exceeded its one-hour limit`)), 60 * 60_000);
    child.on('error', error => finish(error));
    child.stderr?.resume(); // no credentials or dependency diagnostics forwarded
    child.on('message', (message: { type?: string; bytes?: number; value?: T; error?: string }) => {
      if (message.type === 'progress' && Number.isFinite(message.bytes)) {
        try { progress?.(message.bytes!); }
        catch (error) { finish(error instanceof Error ? error : new Error('Could not record update progress')); }
      }
      if (message.type === 'result') finish(undefined, message.value);
      if (message.type === 'error') finish(new Error(message.error ?? `Runtime ${action} failed`));
    });
    child.once('exit', code => { if (!settled) finish(new Error(`Runtime ${action} helper exited (${code})`)); });
    child.send({ action, value });
  });
}
