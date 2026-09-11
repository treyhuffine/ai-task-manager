/**
 * `<app> stop [options]`
 *
 * Stop a running Ri server by port. Looks up the listener PID, sends
 * SIGTERM, escalates to SIGKILL if the port doesn't clear in time. Walks
 * one level up the process tree so we also kill the `next dev`/`next start`
 * launcher that spawned the listener — otherwise the launcher would respawn
 * an orphan, which is the exact footgun the user just hit by hand.
 *
 * Refuses to act if the port is occupied by something that doesn't pass
 * our health probe (no friendly fire on unrelated processes).
 *
 * Voice is intentionally not touched — `<app> voice stop` handles that and
 * the sidecar is often shared across Ri instances.
 */

import { execFileSync } from 'node:child_process';
import { intro, outro, log, spinner } from '@clack/prompts';
import pc from 'picocolors';
import { APP_NAME } from '@/constants/app';
import { DEFAULT_PORT, DEV_PORT, getRunningPort } from '@/lib/auth/port';
import { APP_ROOT_ENV, getDevAppRoot } from '@/lib/config/paths';
import { probeHealth } from '../lib/server';
import {
  clearServerRuntimeIfOwned,
  isProcessAlive,
  readServerRuntime,
  type ServerRuntimeMode,
} from '@/lib/server-runtime/record';

export interface StopOptions {
  port?: string;
  force?: boolean;
  timeout?: string;
  dev?: boolean;
}

export async function stopCommand(opts: StopOptions) {
  intro(pc.bgCyan(pc.black(` ${APP_NAME} stop `)));

  // Mirror `start --dev`: route this process at the dev data root so we read the
  // dev instance's persisted lastPort (and default). Precedence matches start —
  // an explicit env override wins over the --dev auto-set. Must run before
  // getRunningPort(), which reads config.json from whatever root is active.
  if (opts.dev && !process.env[APP_ROOT_ENV]) {
    process.env[APP_ROOT_ENV] = getDevAppRoot();
  }

  // Prefer the managed-instance record for this root: it carries the actual
  // public port and whether the listener is HTTP or HTTPS (HTTP/2). An explicit
  // --port still wins; otherwise fall back to the persisted lastPort/default so
  // a `pnpm dev` server (which writes no record) is still found.
  const record = readServerRuntime();
  let mode: ServerRuntimeMode = 'http';
  let port: number;
  if (opts.port) {
    port = Number(opts.port);
    if (record && record.publicPort === port) mode = record.mode;
  } else if (record && isProcessAlive(record.launcherPid)) {
    port = record.publicPort;
    mode = record.mode;
  } else {
    port = Number(getRunningPort(opts.dev ? DEV_PORT : DEFAULT_PORT));
  }
  if (!Number.isFinite(port) || port <= 0) {
    log.error(`Invalid port: ${opts.port}`);
    outro('Aborted');
    process.exit(1);
  }

  const timeoutMs = Math.max(500, Number(opts.timeout ?? 5000));

  // Confirm we're stopping our own server before signaling anything.
  if (mode === 'https') {
    // A self-signed HTTPS listener can't be validated with a plain HTTP health
    // fetch. The gateway runs IN the launcher process, so the public-port
    // listener PID must match the recorded launcher (a strong ownership proof).
    const pid = findListenerPid(port);
    if (!pid) {
      log.info(`Nothing listening on port ${port}`);
      clearRecordIfDead(record);
      outro('Done');
      return;
    }
    const parent = getParent(pid);
    const ownedByLauncher =
      !!record && (pid === record.launcherPid || parent?.pid === record.launcherPid);
    if (!ownedByLauncher) {
      log.error(
        `Port ${port} is in use but does not match a known ${APP_NAME} HTTPS instance. Refusing to kill it.`,
      );
      outro('Aborted');
      process.exit(1);
    }
  } else {
    const probe = await probeHealth(`http://127.0.0.1:${port}`);
    if (probe.status === 'offline') {
      log.info(`Nothing listening on port ${port}`);
      clearRecordIfDead(record);
      outro('Done');
      return;
    }
    if (probe.status !== 'ok') {
      log.error(
        `Port ${port} is in use, but doesn't look like ${APP_NAME} (${probe.status}` +
          ('detail' in probe ? `: ${probe.detail}` : '') +
          `). Refusing to kill it.`,
      );
      outro('Aborted');
      process.exit(1);
    }
  }

  const listenerPid = findListenerPid(port);
  if (!listenerPid) {
    log.error(`Could not resolve a PID for port ${port} (lsof returned nothing)`);
    outro('Aborted');
    process.exit(1);
  }

  // Walk up one hop. If the parent is a Next launcher (`next dev`/`next start`)
  // or our CLI itself, kill it too — otherwise the launcher would either
  // respawn the child or hang as a zombie. If the parent is a shell or PID 1,
  // leave it alone.
  const targets = [listenerPid];
  const parent = getParent(listenerPid);
  if (parent && isRiParent(parent.command)) {
    targets.unshift(parent.pid);
  }
  // In HTTP/2 mode the public listener is the launcher itself; a graceful signal
  // runs its shutdown handler (which stops the Next child). But a forced kill
  // won't, so also target the private Next child listener directly to avoid
  // orphaning it.
  if (mode === 'https' && record) {
    const privatePort = portFromUrl(record.privateUpstreams.next);
    if (privatePort) {
      const nextPid = findListenerPid(privatePort);
      if (nextPid && !targets.includes(nextPid)) targets.push(nextPid);
    }
  }

  const s = spinner();
  s.start(`Stopping ${APP_NAME} on port ${port} (PID ${targets.join(', ')})`);

  const signal: NodeJS.Signals = opts.force ? 'SIGKILL' : 'SIGTERM';
  for (const pid of targets) {
    try {
      process.kill(pid, signal);
    } catch (err) {
      // ESRCH = already gone, fine.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH') {
        s.stop(pc.red(`Failed to signal PID ${pid}: ${(err as Error).message}`));
        outro('Aborted');
        process.exit(1);
      }
    }
  }

  const cleared = await waitForPortClear(port, timeoutMs);
  if (cleared) {
    s.stop(`Stopped ${APP_NAME} on port ${port}`);
    clearRecordIfDead(record);
    outro('Done');
    return;
  }

  // Graceful shutdown timed out. Escalate (unless we already SIGKILL'd).
  if (signal !== 'SIGKILL') {
    s.stop(pc.yellow(`SIGTERM timed out after ${timeoutMs}ms, sending SIGKILL`));
    for (const pid of targets) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    const finalCleared = await waitForPortClear(port, 2000);
    if (finalCleared) {
      log.success(`Stopped ${APP_NAME} on port ${port}`);
      clearRecordIfDead(record);
      outro('Done');
      return;
    }
  }

  log.error(`Port ${port} still in use after kill. Check \`lsof -iTCP:${port}\``);
  outro('Aborted');
  process.exit(1);
}

/**
 * Resolve the PID listening on a TCP port. Uses `lsof` because there's no
 * portable Node API for "who's bound to this port" and the project already
 * shells out to lsof-equivalents (docker, etc.). macOS/Linux only — same
 * platform constraints as the rest of the CLI.
 */
function findListenerPid(port: number): number | null {
  try {
    const out = execFileSync(
      'lsof',
      ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (!out) return null;
    // lsof can return multiple PIDs (e.g. dual-stack). The first listener
    // is the one we want; if there are siblings they'll be cleaned up when
    // the parent dies, or we'll catch them on a second `stop` invocation.
    const first = out.split(/\s+/)[0];
    const pid = Number(first);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    // lsof exits non-zero when nothing matches — treat as "no listener".
    return null;
  }
}

interface ParentInfo {
  pid: number;
  command: string;
}

function getParent(pid: number): ParentInfo | null {
  try {
    // -o ppid=,command= prints "  1234 /path/to/cmd args..." with no header.
    const out = execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!out) return null;
    const match = out.match(/^\s*(\d+)\s+(.*)$/);
    if (!match) return null;
    const ppid = Number(match[1]);
    if (!Number.isFinite(ppid) || ppid <= 1) return null;
    const ppsOut = execFileSync('ps', ['-o', 'command=', '-p', String(ppid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return { pid: ppid, command: ppsOut };
  } catch {
    return null;
  }
}

/**
 * True if a parent process command line looks like one of ours: a Next
 * launcher we spawned, or the `tsx src/cli/index.ts start` invocation.
 * Conservative on purpose — false here just means we kill only the listener,
 * which is fine 95% of the time.
 */
function isRiParent(command: string): boolean {
  return (
    /\bnext\b.*\b(dev|start)\b/.test(command) ||
    /tsx\s+src\/cli\/index\.ts/.test(command) ||
    /\bcli\/index\.(ts|js)\b/.test(command)
  );
}

/**
 * Wait until no process is LISTENing on the port. Port-based (not health-based)
 * so it works identically for HTTP and self-signed HTTPS listeners — an HTTP
 * health fetch to an HTTPS port would falsely read as "offline".
 */
async function waitForPortClear(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (findListenerPid(port) === null) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** Extract the port from a `http://host:port` upstream URL, or null. */
function portFromUrl(url: string): number | null {
  try {
    const p = Number(new URL(url).port);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * Clear the discovery record if its launcher is no longer alive. A forced kill
 * bypasses the launcher's own shutdown cleanup, so `stop` reconciles the record.
 */
function clearRecordIfDead(record: ReturnType<typeof readServerRuntime>): void {
  if (record && !isProcessAlive(record.launcherPid)) {
    clearServerRuntimeIfOwned(record.runId);
  }
}
