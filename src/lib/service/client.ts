import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { serviceIdentity, servicePaths } from './paths';

export interface ServiceStatus {
  protocol: 1;
  identity: ReturnType<typeof serviceIdentity>;
  runId: string;
  pid: number;
  phase: 'starting' | 'running' | 'stopping' | 'failed' | 'updating';
  version: string;
  release?: import('../releases/compatibility').PeerRelease;
  repo: string;
  /** Executable used by the owning backend, when reported by this controller. */
  node?: string;
  origin?: string;
  error?: string;
  update?: ReturnType<import('./update').UpdateCoordinator['status']>;
  awake?: import('./awake-settings').AwakeStatus;
  /**
   * What this device is for (src/lib/service/role.ts). A device connected
   * to a home elsewhere doesn't run a home: `home` is where its window goes.
   */
  role?: import('./role').ServiceRole['role'];
  home?: { url: string; name: string } | null;
  worker?: import('./worker').ServiceWorkerStatus;
}

export interface ServiceSession extends ServiceStatus { origin: string; certificate: string; token: string; desktopClient: string }

export async function serviceRequest<T>(route: string, method = 'GET', timeoutMs = 3000, body?: unknown): Promise<T> {
  const paths = servicePaths();
  return new Promise((resolve, reject) => {
    // Control calls span controller replacement. Never reuse a pooled socket
    // belonging to the process that just acknowledged recovery/shutdown.
    const request = http.request({ socketPath: paths.socket, path: route, method, agent: false }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 1024 * 1024) request.destroy(new Error('Invalid service response size'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString());
          if (response.statusCode !== 200) throw new Error(value.error ?? `Service returned ${response.statusCode}`);
          if (value.protocol !== 1 || JSON.stringify(value.identity) !== JSON.stringify(paths.identity)) {
            throw new Error('Service identity or control protocol does not match this installation');
          }
          resolve(value as T);
        } catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('Service control request timed out'), { code: 'ETIMEDOUT' })));
    request.on('error', reject);
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

export async function serviceStatus(): Promise<ServiceStatus | null> {
  for (let attempt = 0; ; attempt++) {
    try { return await serviceRequest<ServiceStatus>('/status'); } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (['ENOENT', 'ECONNREFUSED'].includes(code)) return null;
      if (attempt === 0 && ['ECONNRESET', 'EPIPE'].includes(code)) { await new Promise(resolve => setTimeout(resolve, 50)); continue; }
      throw error;
    }
  }
}

export interface ServiceStartOptions { repo: string; node: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }

/** Start or attach to any role without granting a local Home session. */
export async function ensureServiceStatus(options: ServiceStartOptions): Promise<ServiceStatus> {
  const paths = servicePaths();
  let status = await serviceStatus();
  if (!status && !(await (await import('./install')).startInstalledService())) {
    const entry = path.join(options.repo, 'dist/service/main.cjs');
    if (!fs.existsSync(entry)) throw new Error('Build the Ri runtime before starting its service (pnpm cli:build).');
    fs.mkdirSync(path.dirname(paths.log), { recursive: true, mode: 0o700 });
    const log = fs.openSync(paths.log, 'a', 0o600);
    try {
      const child = spawn(options.node, [entry], {
        cwd: options.repo, detached: true, stdio: ['ignore', log, log],
        env: { ...options.env ?? process.env, RI_RUNTIME_REPO: options.repo },
      });
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
    } finally { fs.closeSync(log); }
  }
  const deadline = Date.now() + (options.timeoutMs ?? 180_000);
  while (Date.now() < deadline) {
    status = await serviceStatus();
    if (status?.phase === 'running') return status;
    if (status?.phase === 'failed') throw new Error(status.error ?? 'Service failed to start');
    if (status?.phase === 'stopping') throw new Error('The service is stopping. Wait for it to stop before reopening.');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`The service did not start. Read ${paths.log} for diagnostics.`);
}

/** Only a local Home can issue the private native session. */
export async function ensureService(options: ServiceStartOptions): Promise<ServiceSession> {
  const status = await ensureServiceStatus(options);
  if (status.role && !['home', 'first-run'].includes(status.role)) throw new Error('This device connects to a Home elsewhere. Use its connected viewer session.');
  if (!status.origin) throw new Error('Choose how to use this device before opening Ri.');
  return serviceRequest<ServiceSession>('/session');
}

export async function stopService(): Promise<void> {
  const status = await serviceStatus();
  if (!status) return;
  await serviceRequest('/stop', 'POST');
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) {
    const next = await serviceStatus();
    if (!next) return;
    if (next.runId !== status.runId) throw new Error('A new service started while stopping. It was left running.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Service is still stopping. Inspect its status and log before retrying.');
}
