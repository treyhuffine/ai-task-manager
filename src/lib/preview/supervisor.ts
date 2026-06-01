/**
 * Preview supervisor — process lifecycle for the dev servers behind
 * previews, scoped to a single Flow server process.
 *
 * One supervised process per **preview target** (a worktree, optionally a
 * named service — see `preview_targets`). The caller hands us a stable
 * assigned port; we inject it as `PORT`, spawn the dev command in the
 * worktree, and then **prove the port is actually listening** (TCP
 * confirm) before reporting `running`. The stdout `PortDetector` stays on
 * as a *fallback* for apps that ignore `$PORT` and open a different port.
 *
 * What the supervisor does NOT own:
 *   - Desired state (`preview_targets`: start command, stable port, name).
 *     That's the DB; the supervisor is in-memory and ephemeral.
 *   - Tunnels / reachable URLs. Providers do that (`providers/*`).
 *   - Persistence across Flow restarts (in-memory only — orphan reaping is
 *     a boot-time sweep via `pid-store.sweepOrphans`).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { sanitizeChildEnv } from '@/lib/utils/sanitize-child-env';
import { PortDetector } from './detect-port';
import { confirmListening } from './net';
import { writePid, deletePid } from './pid-store';

export type PreviewStatus =
  | 'idle'         // never started
  | 'starting'     // spawned, confirming the port is up
  | 'running'      // spawned + a port confirmed listening (or alive-but-no-port)
  | 'crashed'      // exited unexpectedly while we expected it up
  | 'stopped';     // exited cleanly after a Stop request

export interface PreviewLogLine {
  /** Monotonic id; suitable as a cursor for incremental log polling. */
  seq: number;
  /** Wall-clock ISO timestamp. */
  at: string;
  stream: 'stdout' | 'stderr';
  /** Single line, no trailing newline. */
  line: string;
}

export interface PreviewProcessRecord {
  /** Preview-target id — the supervisor's process key. */
  key: string;
  pid: number;
  command: string;
  cwd: string;
  status: PreviewStatus;
  /** The stable port we injected as `PORT` and expect the app on. */
  assignedPort: number;
  /** Effective port confirmed listening. May differ from `assignedPort`
   *  if the app ignored `$PORT` and the stdout detector found another.
   *  Null while starting, or when the process is up but no port confirmed. */
  port: number | null;
  /** ISO timestamp of last status transition. */
  startedAt: string;
  /** Set when status is `crashed` or `stopped`. */
  exitedAt: string | null;
  /** Process exit code if known, else null. */
  exitCode: number | null;
  /** Signal name if the process was killed by a signal, else null. */
  signal: string | null;
  /** Human-readable note (e.g. "no port detected within 30s"). */
  message: string | null;
}

interface InternalRecord extends PreviewProcessRecord {
  child: ChildProcess | null;
  detector: PortDetector;
  /** Sequence counter for log lines. */
  logSeq: number;
  /** Ring buffer of recent log lines. */
  logs: PreviewLogLine[];
  /** Partial-line buffer per stream. */
  pending: { stdout: string; stderr: string };
  /** Cleared after Stop / explicit kill — distinguishes intentional exits. */
  expectingExit: boolean;
  /** Aborts the in-flight confirm-listening poll on stop. */
  confirmAbort: AbortController | null;
  /** Resolves once the confirm-listening attempt settles (up/no-port/exit). */
  settled: Promise<void>;
  resolveSettled: () => void;
}

const MAX_LOG_LINES = 1000;
const CONFIRM_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 5_000;

export interface SupervisorEventMap {
  status: [{ key: string; status: PreviewStatus; port: number | null }];
  log: [{ key: string; line: PreviewLogLine }];
}

class PreviewSupervisor extends EventEmitter {
  private readonly procs = new Map<string, InternalRecord>();
  private ignorePorts: Set<number> | null = null;

  /**
   * Start (or return the existing) supervised process for a preview target.
   *
   * Idempotent + race-safe: a running/starting target returns its existing
   * record untouched; a Stop-in-flight is awaited before a fresh spawn so a
   * quick Stop→Start can't return a record pointing at a dying port.
   */
  async start(input: {
    key: string;
    command: string;
    cwd: string;
    /** Stable port to inject as `PORT` and confirm-listen on. */
    port: number;
    /** Additional env layered on top of process.env. */
    env?: Record<string, string>;
  }): Promise<PreviewProcessRecord> {
    const existing = this.procs.get(input.key);
    if (existing) {
      if (existing.expectingExit && existing.child && existing.status !== 'stopped' && existing.status !== 'crashed') {
        // Stop-in-flight: wait it out, then spawn fresh.
        await new Promise<void>((resolve) => {
          existing.child!.once('exit', () => resolve());
          setTimeout(resolve, KILL_GRACE_MS + 1_000);
        });
      } else if (existing.status === 'starting' || existing.status === 'running') {
        return toPublic(existing);
      }
      this.procs.delete(input.key);
    }

    if (!input.command.trim()) {
      throw new SupervisorError('preview_no_command', 'No preview command set for this worktree.');
    }
    if (!Number.isInteger(input.port) || input.port <= 0) {
      throw new SupervisorError('preview_no_port', 'No port assigned for this preview.');
    }

    const detector = new PortDetector({ ignorePorts: this.getIgnoredPorts() });

    // Spawn under a login shell so the user's PATH (nvm, pyenv, cargo, …) is
    // honored. `sh -lc` not `bash -lc` so Linux users without bash still work.
    // The assigned PORT is injected LAST so it always wins — a stray `PORT`
    // in caller-supplied env (e.g. a multi-service `env` block) can't override
    // it and break confirm-listening.
    const child = spawn('sh', ['-lc', input.command], {
      cwd: input.cwd,
      env: sanitizeChildEnv({ ...input.env, PORT: String(input.port) }),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group → kill the whole tree (sh → npm → next → …)
    });

    if (!child.pid) {
      throw new SupervisorError('preview_spawn_failed', 'Failed to spawn preview process.');
    }

    // Crash-safe PID record so a Flow restart can reap orphans. child.pid == pgid (detached).
    try {
      writePid({
        key: input.key,
        pid: child.pid,
        pgid: child.pid,
        command: input.command,
        startedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[preview] failed to write pid file:', err);
    }

    let resolveSettled!: () => void;
    const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });

    const now = new Date().toISOString();
    const rec: InternalRecord = {
      key: input.key,
      pid: child.pid,
      command: input.command,
      cwd: input.cwd,
      status: 'starting',
      assignedPort: input.port,
      port: null,
      startedAt: now,
      exitedAt: null,
      exitCode: null,
      signal: null,
      message: null,
      child,
      detector,
      logSeq: 0,
      logs: [],
      pending: { stdout: '', stderr: '' },
      expectingExit: false,
      confirmAbort: new AbortController(),
      settled,
      resolveSettled,
    };

    this.wireStreams(rec, 'stdout');
    this.wireStreams(rec, 'stderr');

    child.on('exit', (code, signal) => this.onExit(rec, code, signal));
    child.on('error', (err) => {
      this.appendLog(rec, 'stderr', `[supervisor] spawn error: ${err.message}`);
      this.onExit(rec, null, null);
    });

    this.procs.set(input.key, rec);
    this.emit('status', { key: rec.key, status: rec.status, port: rec.port });

    // Confirm the port is actually accepting connections before we call it
    // running. Candidate set is the assigned port plus whatever the stdout
    // detector turns up (apps that ignore $PORT). Runs in the background;
    // status flips via events + `awaitListening`.
    void this.runConfirm(rec);

    return toPublic(rec);
  }

  private async runConfirm(rec: InternalRecord): Promise<void> {
    try {
      const found = await confirmListening(
        () => {
          const ports = [rec.assignedPort];
          const detected = rec.detector.port();
          if (detected) ports.push(detected);
          return ports;
        },
        { timeoutMs: CONFIRM_TIMEOUT_MS, signal: rec.confirmAbort?.signal },
      );
      if (rec.status === 'stopped' || rec.status === 'crashed') return; // exited while confirming
      if (found !== null) {
        rec.port = found;
        rec.status = 'running';
        rec.message = found !== rec.assignedPort
          ? `App ignored PORT=${rec.assignedPort}; detected on ${found}.`
          : null;
        this.emit('status', { key: rec.key, status: 'running', port: found });
      } else if (rec.status === 'starting') {
        // Process is (probably) still alive but never opened a reachable
        // port. Surface a clear no-port state instead of hanging in
        // "starting" forever. The UI renders the running-no-port affordance;
        // providers that need a port surface an actionable error.
        rec.status = 'running';
        rec.port = null;
        rec.message = `No reachable port within ${Math.round(CONFIRM_TIMEOUT_MS / 1000)}s. Check the dev command or set a port.`;
        this.emit('status', { key: rec.key, status: 'running', port: null });
      }
    } finally {
      rec.resolveSettled();
    }
  }

  /**
   * Await the confirm-listening attempt, bounded by `timeoutMs`. Resolves
   * with the current record once a port is confirmed (or the no-port /
   * crashed terminal is reached), or when the bound elapses. The service
   * layer uses this so `resolve()` can return a confirmed port.
   */
  async awaitListening(key: string, timeoutMs = CONFIRM_TIMEOUT_MS + 2_000): Promise<PreviewProcessRecord | null> {
    const rec = this.procs.get(key);
    if (!rec) return null;
    if (rec.status === 'running' || rec.status === 'crashed' || rec.status === 'stopped') {
      return toPublic(rec);
    }
    await Promise.race([rec.settled, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
    return toPublic(rec);
  }

  /**
   * Stop a supervised process. SIGTERM, then SIGKILL after KILL_GRACE_MS.
   * Returns the final record (status=`stopped`). No-op if nothing's running.
   */
  async stop(key: string): Promise<PreviewProcessRecord | null> {
    const rec = this.procs.get(key);
    if (!rec) return null;
    if (rec.status === 'stopped' || rec.status === 'crashed') return toPublic(rec);

    rec.expectingExit = true;
    rec.confirmAbort?.abort();

    const child = rec.child;
    if (!child) {
      rec.status = 'stopped';
      rec.exitedAt = new Date().toISOString();
      this.emit('status', { key: rec.key, status: 'stopped', port: null });
      return toPublic(rec);
    }

    try {
      process.kill(-child.pid!, 'SIGTERM');
    } catch {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }

    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
        }
        resolve();
      }, KILL_GRACE_MS);
      child.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });

    return toPublic(rec);
  }

  /** Stop every running process. Used at server shutdown. */
  async stopAll(): Promise<void> {
    const keys = Array.from(this.procs.keys());
    await Promise.all(keys.map((k) => this.stop(k)));
  }

  status(key: string): PreviewProcessRecord | null {
    const rec = this.procs.get(key);
    return rec ? toPublic(rec) : null;
  }

  /** Effective port if the target is up, else null. */
  getPort(key: string): number | null {
    const rec = this.procs.get(key);
    if (!rec) return null;
    if (rec.status !== 'starting' && rec.status !== 'running') return null;
    return rec.port;
  }

  /** Is this target currently up (running with a confirmed port)? */
  isListening(key: string): boolean {
    const rec = this.procs.get(key);
    return !!rec && rec.status === 'running' && rec.port !== null;
  }

  /** Keys with a live (running/starting) process — the idle-evict candidates. */
  liveKeys(): string[] {
    const out: string[] = [];
    for (const [key, rec] of this.procs) {
      if (rec.status === 'running' || rec.status === 'starting') out.push(key);
    }
    return out;
  }

  logsSince(key: string, cursor: number): PreviewLogLine[] {
    const rec = this.procs.get(key);
    if (!rec) return [];
    if (cursor <= 0) return rec.logs.slice();
    return rec.logs.filter((l) => l.seq > cursor);
  }

  setIgnoredPorts(ports: Iterable<number>): void {
    this.ignorePorts = new Set(ports);
  }

  // ─── internals ────────────────────────────────────────────────

  private getIgnoredPorts(): Set<number> {
    if (this.ignorePorts) return this.ignorePorts;
    const flowPort = Number(process.env.PORT ?? '4224');
    const set = new Set<number>();
    if (Number.isFinite(flowPort)) set.add(flowPort);
    this.ignorePorts = set;
    return set;
  }

  private wireStreams(rec: InternalRecord, stream: 'stdout' | 'stderr'): void {
    const handle = stream === 'stdout' ? rec.child!.stdout : rec.child!.stderr;
    if (!handle) return;

    handle.setEncoding('utf8');
    handle.on('data', (chunk: string) => {
      // Feed the detector (fallback port discovery for apps that ignore $PORT).
      if (rec.port === null) {
        rec.detector.feedAndCheck(chunk);
      }

      // Line-oriented logging. Hold partial lines until the next chunk.
      let accumulator = rec.pending[stream] + chunk;
      let nl: number;
      while ((nl = accumulator.indexOf('\n')) >= 0) {
        const line = accumulator.slice(0, nl).replace(/\r$/, '');
        accumulator = accumulator.slice(nl + 1);
        this.appendLog(rec, stream, line);
      }
      rec.pending[stream] = accumulator;
    });
  }

  private appendLog(rec: InternalRecord, stream: 'stdout' | 'stderr', line: string): void {
    rec.logSeq += 1;
    const entry: PreviewLogLine = {
      seq: rec.logSeq,
      at: new Date().toISOString(),
      stream,
      line,
    };
    rec.logs.push(entry);
    if (rec.logs.length > MAX_LOG_LINES) {
      rec.logs.splice(0, rec.logs.length - MAX_LOG_LINES);
    }
    this.emit('log', { key: rec.key, line: entry });
  }

  private onExit(rec: InternalRecord, code: number | null, signal: NodeJS.Signals | null): void {
    rec.confirmAbort?.abort();
    // Drain any final pending line that didn't get a newline.
    for (const stream of ['stdout', 'stderr'] as const) {
      const tail = rec.pending[stream];
      if (tail.length > 0) {
        this.appendLog(rec, stream, tail);
        rec.pending[stream] = '';
      }
    }
    rec.exitCode = code;
    rec.signal = signal;
    rec.exitedAt = new Date().toISOString();
    rec.status = rec.expectingExit ? 'stopped' : 'crashed';
    rec.port = null;
    rec.child = null;
    rec.resolveSettled();
    try { deletePid(rec.key); } catch { /* ignore */ }
    this.emit('status', { key: rec.key, status: rec.status, port: null });
  }
}

export class SupervisorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'SupervisorError';
  }
}

function toPublic(rec: InternalRecord): PreviewProcessRecord {
  const {
    child: _c, detector: _d, logSeq: _ls, logs: _l, pending: _p,
    expectingExit: _e, confirmAbort: _ca, settled: _s, resolveSettled: _rs,
    ...pub
  } = rec;
  return pub;
}

// Singleton — one supervisor per Node process. Stored on globalThis so
// Next.js's dev-mode module reloading doesn't fork the process map and
// leak orphans on every save.
declare global {
  // eslint-disable-next-line no-var
  var __flowPreviewSupervisor: PreviewSupervisor | undefined;
}

export function getSupervisor(): PreviewSupervisor {
  if (!globalThis.__flowPreviewSupervisor) {
    globalThis.__flowPreviewSupervisor = new PreviewSupervisor();
  }
  return globalThis.__flowPreviewSupervisor;
}

export type { PreviewSupervisor };
