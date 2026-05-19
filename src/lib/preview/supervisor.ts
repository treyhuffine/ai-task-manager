/**
 * Preview supervisor — process map + ring buffer + port detection,
 * scoped to a single Flow server process.
 *
 * One subprocess per workspace at most. The user clicks Start in the
 * preview pane; the supervisor spawns the workspace's `preview_command`
 * (whatever string they configured) under a shell, in the workspace's
 * cwd (or worktree path for git workspaces). Stdout + stderr go through
 * the port detector and into a bounded ring buffer the UI tails.
 *
 * The supervisor is intentionally simple. It does not own:
 *   - The proxy route (separate; reads our `getPort` to find the upstream).
 *   - Auth / preview tokens (the supervisor mints them, but doesn't check
 *     headers — the proxy route does that).
 *   - Portless mode (separate module; supervisor is skipped entirely there).
 *   - Persistence of process state across Flow restarts (in-memory only —
 *     orphan reaping is handled by a startup sweep in P4 polish).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { sanitizeChildEnv } from '@/lib/utils/sanitize-child-env';
import { PortDetector } from './detect-port';
import { writePid, deletePid } from './pid-store';

export type PreviewStatus =
  | 'idle'         // never started
  | 'starting'     // spawned, no port yet
  | 'running'      // spawned, port detected (or override pinned)
  | 'crashed'      // exited with non-zero or signaled while we expected it up
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
  workspace_id: string;
  pid: number;
  command: string;
  cwd: string;
  status: PreviewStatus;
  port: number | null;
  /** A short-lived token the client embeds in the iframe `?_pt=` query. */
  preview_token: string;
  /** ISO timestamp of last status transition. */
  started_at: string;
  /** Set when status is `crashed` or `stopped`. */
  exited_at: string | null;
  /** Process exit code if known, else null. */
  exit_code: number | null;
  /** Signal name if the process was killed by a signal, else null. */
  signal: string | null;
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
  /** Optional override port — supervisor pretends the process printed it. */
  pinnedPort: number | null;
  /** Timer for the port-detection timeout. */
  detectTimeout: NodeJS.Timeout | null;
}

const MAX_LOG_LINES = 1000;
const PORT_DETECT_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 5_000;

export interface SupervisorEventMap {
  status: [{ workspace_id: string; status: PreviewStatus; port: number | null }];
  log: [{ workspace_id: string; line: PreviewLogLine }];
}

class PreviewSupervisor extends EventEmitter {
  private readonly procs = new Map<string, InternalRecord>();
  /**
   * Ports the detector should skip — populated lazily on first use with
   * the Flow server's listening port so a framework banner re-printing
   * Flow's own URL never gets mistaken for the app's port.
   */
  private ignorePorts: Set<number> | null = null;

  /**
   * Start (or return the existing) preview process for a workspace.
   *
   * Idempotent + race-safe:
   *   - If a process is currently running for this workspace, the
   *     existing record is returned untouched.
   *   - If a Stop is in flight (the supervisor sent SIGTERM but the
   *     child hasn't exited yet), we wait for the exit BEFORE spawning
   *     a fresh one. Without this, a quick Stop → Start sequence would
   *     return a record pointing at a dying port, and the iframe would
   *     load against a process about to disappear.
   */
  async start(input: {
    workspace_id: string;
    command: string;
    cwd: string;
    /** Pin a fixed port; skip stdout scraping. */
    port_override?: number | null;
    /** Additional env to layer on top of process.env (e.g., PORT preferences). */
    env?: Record<string, string>;
  }): Promise<PreviewProcessRecord> {
    const existing = this.procs.get(input.workspace_id);
    if (existing) {
      // Stop-in-flight: wait it out, then spawn fresh.
      if (existing.expectingExit && existing.child && existing.status !== 'stopped' && existing.status !== 'crashed') {
        await new Promise<void>((resolve) => {
          const onExit = () => resolve();
          existing.child!.once('exit', onExit);
          // Belt-and-suspenders: if the exit event already fired and
          // we hooked late, the supervisor's onExit() has already run
          // and cleared `child`. The check above guards against that
          // case (`child` would be null), so we know we're listening
          // before exit happens. Still, set a hard upper bound so a
          // process that ignores SIGTERM doesn't deadlock us — the
          // supervisor's own grace timer will SIGKILL it.
          setTimeout(resolve, KILL_GRACE_MS + 1_000);
        });
      } else if (existing.status === 'starting' || existing.status === 'running') {
        return toPublic(existing);
      }
      // Clean any old record so the slot is free.
      this.procs.delete(input.workspace_id);
    }

    if (!input.command.trim()) {
      throw new SupervisorError('preview_no_command', 'No preview command set for this workspace.');
    }

    const detector = new PortDetector({ ignorePorts: this.getIgnoredPorts() });
    if (input.port_override) detector.set(input.port_override);

    const previewToken = randomBytes(16).toString('base64url');

    // Spawn under a login shell so the user's PATH (nvm, pyenv, cargo,
    // rbenv, etc.) is honored. `sh -lc` rather than `bash -lc` so Linux
    // users without bash installed still work.
    const child = spawn('sh', ['-lc', input.command], {
      cwd: input.cwd,
      env: sanitizeChildEnv(input.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      // New process group so we can kill the whole tree (sh → npm → next → ...).
      detached: true,
    });

    if (!child.pid) {
      throw new SupervisorError('preview_spawn_failed', 'Failed to spawn preview process.');
    }

    // Crash-safe PID record so a Flow restart can find and reap orphans.
    // The child's PID == its PGID because we set `detached: true`.
    try {
      writePid({
        workspace_id: input.workspace_id,
        pid: child.pid,
        pgid: child.pid,
        command: input.command,
        started_at: new Date().toISOString(),
      });
    } catch (err) {
      // PID-file write failures aren't fatal — the process is running,
      // we just can't sweep it on next boot. Surface in logs but proceed.
      console.warn('[preview] failed to write pid file:', err);
    }

    const now = new Date().toISOString();
    const rec: InternalRecord = {
      workspace_id: input.workspace_id,
      pid: child.pid,
      command: input.command,
      cwd: input.cwd,
      status: 'starting',
      port: input.port_override ?? null,
      preview_token: previewToken,
      started_at: now,
      exited_at: null,
      exit_code: null,
      signal: null,
      child,
      detector,
      logSeq: 0,
      logs: [],
      pending: { stdout: '', stderr: '' },
      expectingExit: false,
      pinnedPort: input.port_override ?? null,
      detectTimeout: null,
    };

    if (rec.port !== null) {
      rec.status = 'running';
    } else {
      rec.detectTimeout = setTimeout(() => {
        // Port didn't appear in time. We still consider the process
        // running — UI will surface the "no port detected" affordance.
        if (rec.status === 'starting') {
          rec.status = 'running';
          this.emit('status', { workspace_id: rec.workspace_id, status: 'running', port: null });
        }
      }, PORT_DETECT_TIMEOUT_MS);
    }

    this.wireStreams(rec, 'stdout');
    this.wireStreams(rec, 'stderr');

    child.on('exit', (code, signal) => {
      this.onExit(rec, code, signal);
    });
    child.on('error', (err) => {
      this.appendLog(rec, 'stderr', `[supervisor] spawn error: ${err.message}`);
      this.onExit(rec, null, null);
    });

    this.procs.set(input.workspace_id, rec);
    this.emit('status', {
      workspace_id: rec.workspace_id,
      status: rec.status,
      port: rec.port,
    });
    return toPublic(rec);
  }

  /**
   * Stop a workspace's preview process. SIGTERM first, then SIGKILL after
   * `KILL_GRACE_MS` if it's still alive. Returns the final record
   * (status=`stopped`). No-op if there's no process running.
   */
  async stop(workspaceId: string): Promise<PreviewProcessRecord | null> {
    const rec = this.procs.get(workspaceId);
    if (!rec) return null;
    if (rec.status === 'stopped' || rec.status === 'crashed') return toPublic(rec);

    rec.expectingExit = true;
    if (rec.detectTimeout) {
      clearTimeout(rec.detectTimeout);
      rec.detectTimeout = null;
    }

    const child = rec.child;
    if (!child) {
      rec.status = 'stopped';
      rec.exited_at = new Date().toISOString();
      this.emit('status', { workspace_id: rec.workspace_id, status: 'stopped', port: null });
      return toPublic(rec);
    }

    try {
      // Kill the entire process group. The `-pid` form sends the
      // signal to the group leader (which `detached: true` made us).
      process.kill(-child.pid!, 'SIGTERM');
    } catch {
      // Group might already be gone — try the bare PID as a fallback.
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore — process already dead
      }
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
    const ids = Array.from(this.procs.keys());
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  status(workspaceId: string): PreviewProcessRecord | null {
    const rec = this.procs.get(workspaceId);
    return rec ? toPublic(rec) : null;
  }

  /** Live port lookup used by the proxy route on every request. */
  getPort(workspaceId: string): number | null {
    const rec = this.procs.get(workspaceId);
    if (!rec) return null;
    if (rec.status !== 'starting' && rec.status !== 'running') return null;
    return rec.port;
  }

  /** Validate a `_pt` token for a workspace. */
  isTokenValid(workspaceId: string, token: string): boolean {
    const rec = this.procs.get(workspaceId);
    if (!rec) return false;
    return rec.preview_token === token;
  }

  /** Rotate the preview token (used by /refresh-token). */
  rotateToken(workspaceId: string): string | null {
    const rec = this.procs.get(workspaceId);
    if (!rec) return null;
    rec.preview_token = randomBytes(16).toString('base64url');
    return rec.preview_token;
  }

  /**
   * Return all log lines with seq > cursor. Suitable for incremental
   * polling by the UI's logs strip.
   */
  logsSince(workspaceId: string, cursor: number): PreviewLogLine[] {
    const rec = this.procs.get(workspaceId);
    if (!rec) return [];
    if (cursor <= 0) return rec.logs.slice();
    // Linear scan is fine — ring buffer is bounded at MAX_LOG_LINES.
    return rec.logs.filter((l) => l.seq > cursor);
  }

  setIgnoredPorts(ports: Iterable<number>): void {
    this.ignorePorts = new Set(ports);
  }

  // ─── internals ────────────────────────────────────────────────

  private getIgnoredPorts(): Set<number> {
    if (this.ignorePorts) return this.ignorePorts;
    // Lazy default — the Flow port at minimum. Avoids pulling in app
    // constants from a module that may load early.
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
      // Port detection (only while we haven't pinned a port).
      if (rec.pinnedPort === null && rec.port === null) {
        const found = rec.detector.feedAndCheck(chunk);
        if (found !== null) {
          rec.port = found;
          if (rec.detectTimeout) {
            clearTimeout(rec.detectTimeout);
            rec.detectTimeout = null;
          }
          if (rec.status === 'starting') {
            rec.status = 'running';
            this.emit('status', { workspace_id: rec.workspace_id, status: 'running', port: found });
          }
        }
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
    this.emit('log', { workspace_id: rec.workspace_id, line: entry });
  }

  private onExit(rec: InternalRecord, code: number | null, signal: NodeJS.Signals | null): void {
    if (rec.detectTimeout) {
      clearTimeout(rec.detectTimeout);
      rec.detectTimeout = null;
    }
    // Drain any final pending line that didn't get a newline.
    for (const stream of ['stdout', 'stderr'] as const) {
      const tail = rec.pending[stream];
      if (tail.length > 0) {
        this.appendLog(rec, stream, tail);
        rec.pending[stream] = '';
      }
    }
    rec.exit_code = code;
    rec.signal = signal;
    rec.exited_at = new Date().toISOString();
    if (rec.expectingExit) {
      rec.status = 'stopped';
    } else {
      rec.status = 'crashed';
    }
    rec.port = null;
    rec.child = null;
    // Clean up the PID file — the process is gone, no orphan to sweep.
    try { deletePid(rec.workspace_id); } catch { /* ignore */ }
    this.emit('status', {
      workspace_id: rec.workspace_id,
      status: rec.status,
      port: null,
    });
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
  const { child: _c, detector: _d, logSeq: _ls, logs: _l, pending: _p, expectingExit: _e, pinnedPort: _pp, detectTimeout: _dt, ...pub } = rec;
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
