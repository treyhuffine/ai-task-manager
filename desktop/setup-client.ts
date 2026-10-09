import { execFile } from 'node:child_process';
import path from 'node:path';

/** Secret-bearing setup input travels through stdin, never process arguments. */
export function setupRequest<T>(node: string, repo: string, env: NodeJS.ProcessEnv, request: unknown, timeoutMs = 45_000): Promise<T> {
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > 32 * 1024) return Promise.reject(new Error('Setup request is too large.'));
  return new Promise((resolve, reject) => {
    const child = execFile(node, [path.join(repo, 'dist/desktop/connection-setup-entry.cjs')], { env, timeout: timeoutMs, maxBuffer: 128 * 1024 }, (error, stdout) => {
      try {
        const response = JSON.parse(stdout);
        if (response.ok !== true) throw new Error(typeof response.error === 'string' ? response.error : 'Setup could not finish.');
        if (error) throw new Error('Setup process did not finish.');
        resolve(response.result);
      } catch (failure) { reject(failure instanceof SyntaxError ? new Error('Setup could not start. Rebuild or reinstall this desktop runtime.') : failure); }
    });
    child.stdin?.on('error', () => { /* Completion callback reports process failures. */ });
    child.stdin?.end(input);
  });
}
