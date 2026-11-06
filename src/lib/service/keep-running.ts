/**
 * Keeping a Home running (docs/always-on-spec.md sections 4.1, 6.4 and 10.3).
 * `ri start` and `ri team create` hand a Home to the OS here: the Home gets a
 * release to run, keeps its address, and its OS job starts it now and after
 * every restart. The same steps take over a Home that ran in a terminal or
 * under an older unsupervised service.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { readAuthConfig } from '@/lib/auth/config-file';
import { DEFAULT_PORT } from '@/lib/auth/port';
import { runtimeReleaseIdentity, runtimeRepository } from '@/lib/releases/runtime-identity';
import { untraced } from '@/lib/utils/untraced';
import type { ServiceStatus } from './client';
import { servicePaths } from './paths';
import { adoptRelease, installedRuntime, stageRuntime } from './runtime';
import { latestRelease } from './store';
import { clearStopped } from './stopped';

/** What `local-service.json` holds: the address a Home serves. */
export interface HomeAddress { version: 1; port: number; privatePort?: number; scheme?: 'http' | 'https'; host?: string }

export function readHomeAddress(file = servicePaths().settings): HomeAddress | null {
  try { return JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ file, 'utf8')) as HomeAddress; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export function addressOrigin(address: HomeAddress) {
  return `${address.scheme ?? 'https'}://localhost:${address.port}`;
}

export class AddressError extends Error {}

/**
 * The address a Home keeps. A Home the service already serves keeps the one
 * it has. Any other Home keeps the one it had in a terminal: plain HTTP on its
 * last port, 4224 for one that never ran, or `-p` for a new Home.
 */
export function recordHomeAddress(options: { port?: number } = {}, file = servicePaths().settings): { address: HomeAddress; recorded: boolean } {
  const existing = readHomeAddress(file);
  if (existing) {
    if (options.port !== undefined && options.port !== existing.port) {
      throw new AddressError(`This Home's address is ${addressOrigin(existing)}. Ri keeps a Home's address so open tabs, agents and tunnels keep working, so run it again without -p.`);
    }
    return { address: existing, recorded: false };
  }
  const port = options.port ?? readAuthConfig()?.lastPort ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new AddressError(`Ri can't serve a Home on port ${port}. Choose one from 1024 to 65535.`);
  const address: HomeAddress = { version: 1, port, scheme: 'http', host: '0.0.0.0' };
  fs.mkdirSync(/* turbopackIgnore: true */ path.dirname(file), { recursive: true, mode: 0o700 });
  atomicWriteFile(file, JSON.stringify(address));
  return { address, recorded: true };
}

/** What holds a port, or null when it's free. */
export async function portHolder(port: number): Promise<string | null> {
  const free = await new Promise<boolean>(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '0.0.0.0', exclusive: true }, () => server.close(() => resolve(true)));
  });
  if (free) return null;
  try {
    const out = execFileSync(untraced('lsof'), ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const pid = /^p(\d+)$/m.exec(out)?.[1];
    const name = /^c(.+)$/m.exec(out)?.[1];
    if (pid) return `${name ?? 'a process'} (pid ${pid})`;
  } catch { /* lsof is missing or found nothing it may show */ }
  return 'another program';
}

export type HomeRelease = { id: string; how: 'running' | 'adopted' | 'own' };

function packagedCli() {
  try { return runtimeReleaseIdentity().source === 'packaged'; } catch { return false; }
}

/** Whether this Home has a release it could run, without changing anything. */
export function releaseAvailable() {
  return !!installedRuntime() || !!latestRelease() || packagedCli();
}

/**
 * A release for this Home to run: the one it runs, else the newest on this
 * computer, else the release this CLI came from. Null for a checkout's CLI on
 * a computer with no release yet, which can only run in the foreground.
 */
export function ensureHomeRelease(): HomeRelease | null {
  const running = installedRuntime();
  if (running) return { id: running.id, how: 'running' };
  const latest = latestRelease();
  if (latest) return { id: adoptRelease(latest).id, how: 'adopted' };
  if (!packagedCli()) return null;
  return { id: stageRuntime(path.dirname(runtimeRepository())).id, how: 'own' };
}

export interface KeepRunningDeps {
  status(): Promise<ServiceStatus | null>;
  /** The OS job exists already. */
  supervised?(): boolean;
  install(): Promise<unknown>;
  holder(port: number): Promise<string | null>;
  sleep(ms: number): Promise<void>;
  now(): number;
  progress?(line: string): void;
}

export type KeepRunningResult =
  | { result: 'running'; origin: string; status: ServiceStatus; release: HomeRelease; recorded: boolean }
  | { result: 'no-release' }
  | { result: 'failed'; reason: string };

/** Start a server's worth of waiting: three minutes, plus room for migrations. */
const START_WAIT_MS = 6 * 60_000;

/**
 * Supervise this Home and wait until it serves. The caller has already made
 * sure nothing runs it in a terminal, and created it if it's new. A new Home
 * from `ri start` gets the terminal's address. A new team's address is the
 * service's choice, as it always was (`address: 'service'`).
 */
export async function keepRunning(options: { port?: number; address?: 'terminal' | 'service' }, deps: KeepRunningDeps): Promise<KeepRunningResult> {
  const release = ensureHomeRelease();
  if (!release) return { result: 'no-release' };
  const before = await deps.status();
  // Already kept running and serving: installing again changes nothing, and
  // this controller keeps its run, so waiting for a new one would never end.
  if (before?.phase === 'running' && before.origin && deps.supervised?.()) return { result: 'running', origin: before.origin, status: before, release, recorded: false };
  const { address, recorded } = options.address === 'service'
    ? { address: readHomeAddress(), recorded: false }
    : recordHomeAddress({ port: options.port });
  // A Home the service doesn't serve yet must find its port free (10.3).
  if (address && !before?.origin) {
    const holder = await deps.holder(address.port);
    if (holder) {
      return { result: 'failed', reason: `Port ${address.port} is in use by ${holder}. This Home keeps ${addressOrigin(address)}, so stop that first, then run this again.` };
    }
  }
  clearStopped();
  deps.progress?.(before ? 'Handing the running Home over to supervision' : 'Starting Ri');
  await deps.install();
  const deadline = deps.now() + START_WAIT_MS;
  let last: ServiceStatus | null = null;
  while (deps.now() < deadline) {
    try { last = await deps.status(); } catch { last = null; }
    if (last && last.runId !== before?.runId) {
      if (last.phase === 'running' && last.origin) return { result: 'running', origin: last.origin, status: last, release, recorded };
      if (last.phase === 'failed') return { result: 'failed', reason: last.error ?? 'The Home failed to start.' };
      // It keeps retrying by itself. After a few tries, say why instead of waiting on.
      if (last.phase === 'restarting' && (last.restarts?.crashLoop || (last.restarts?.count ?? 0) >= 3)) {
        return { result: 'failed', reason: `${last.error ?? 'The Home failed to start.'} Ri keeps trying in the background.` };
      }
    }
    await deps.sleep(500);
  }
  return { result: 'failed', reason: last?.error ?? 'The Home did not start within six minutes. It keeps trying in the background: check `ri status` and `ri logs`.' };
}
