/**
 * PTY lifecycle for in-app terminals.
 *
 * Each execution session can host many terminals — the user opens them
 * with the `+` button in the terminal panel. Each terminal is a real
 * `node-pty` child running the user's `$SHELL` rooted at the session's
 * worktree (or the workspace cwd if there's no worktree).
 *
 * Terminals are server-side state. They survive page reloads and
 * Next.js HMR (we stash the registry on `globalThis`) so a long
 * `npm install` keeps running while the user navigates around.
 * Closing the tab in the UI sends `DELETE` which kills the PTY; nothing
 * GCs idle terminals automatically — that's a fine V1, the user is
 * the one who created them.
 *
 * Output is fanned out two ways: every connected SSE listener gets a
 * live chunk, and a bounded ring buffer (256KB) keeps recent bytes for
 * replay on reconnect so the user sees state when they refresh.
 */
import * as nodePty from 'node-pty';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { sanitizeChildEnv } from '@/lib/utils/sanitize-child-env';

const MAX_BUFFER_BYTES = 256 * 1024;

export type TerminalChunk =
  | { type: 'data'; data: string }
  | { type: 'exit'; code: number | null; signal: number | null };

export type TerminalListener = (chunk: TerminalChunk) => void;

interface ManagedTerminal {
  id: string;
  sessionId: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  proc: nodePty.IPty;
  buffer: string[];
  bufferBytes: number;
  exited: boolean;
  exitCode: number | null;
  exitSignal: number | null;
  listeners: Set<TerminalListener>;
  createdAt: string;
}

export interface TerminalDescriptor {
  id: string;
  sessionId: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  exited: boolean;
  exitCode: number | null;
  createdAt: string;
}

interface PtyRegistry {
  terminals: Map<string, ManagedTerminal>;
}

// Stash on globalThis so the registry survives HMR in dev. Without this,
// every file save would orphan the PTY processes started before the
// reload — they'd keep running but the new module wouldn't see them.
const g = globalThis as unknown as { __ptyRegistry?: PtyRegistry };
if (!g.__ptyRegistry) g.__ptyRegistry = { terminals: new Map() };
const terminals = g.__ptyRegistry.terminals;

/**
 * User's preferred shell, validated to actually exist on disk. Falls
 * back through a small list per platform — `posix_spawnp` will error
 * out before we ever see stdout if the binary is missing, which makes
 * for a confusing "terminal won't open" symptom otherwise.
 */
function resolveShell(): string {
  const candidates: string[] = [];
  if (process.env.SHELL) candidates.push(process.env.SHELL);
  if (process.platform === 'win32') {
    candidates.push('powershell.exe', 'cmd.exe');
  } else {
    candidates.push('/bin/zsh', '/bin/bash', '/bin/sh');
  }
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {
      // try next
    }
  }
  // Last resort — let node-pty raise a clean error if even /bin/sh is gone.
  return candidates[0] ?? '/bin/sh';
}

/** Throw a clean, surface-able error when the cwd doesn't exist. */
function ensureDirectory(cwd: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch {
    throw new TerminalSpawnError(
      `Working directory does not exist: ${cwd}`,
      'cwd_missing',
    );
  }
  if (!stat.isDirectory()) {
    throw new TerminalSpawnError(
      `Path is not a directory: ${cwd}`,
      'cwd_not_directory',
    );
  }
}

export class TerminalSpawnError extends Error {
  constructor(message: string, public readonly code: 'cwd_missing' | 'cwd_not_directory' | 'spawn_failed') {
    super(message);
    this.name = 'TerminalSpawnError';
  }
}

/** Strip the bookkeeping fields the wire format doesn't need. */
function describe(t: ManagedTerminal): TerminalDescriptor {
  return {
    id: t.id,
    sessionId: t.sessionId,
    cwd: t.cwd,
    shell: t.shell,
    cols: t.cols,
    rows: t.rows,
    exited: t.exited,
    exitCode: t.exitCode,
    createdAt: t.createdAt,
  };
}

function appendBuffer(t: ManagedTerminal, data: string) {
  t.buffer.push(data);
  t.bufferBytes += Buffer.byteLength(data, 'utf8');
  while (t.bufferBytes > MAX_BUFFER_BYTES && t.buffer.length > 1) {
    const oldest = t.buffer.shift()!;
    t.bufferBytes -= Buffer.byteLength(oldest, 'utf8');
  }
}

export interface CreateTerminalInput {
  sessionId: string;
  cwd: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string | undefined>;
}

export function createTerminal(input: CreateTerminalInput): TerminalDescriptor {
  ensureDirectory(input.cwd);

  const id = randomUUID();
  const cols = input.cols ?? 80;
  const rows = input.rows ?? 24;
  const shell = resolveShell();
  // Sanitized base env strips Next.js worker plumbing (TURBOPACK,
  // __NEXT_PRIVATE_ORIGIN, NEXT_PRIVATE_WORKER, PORT, …) that Flow's
  // own Node process inherits as a Next dev worker. Without this, every
  // pty inherits those vars and any `next dev` (or IDE the user launches
  // from this terminal) thinks it's a Flow worker on :4224 with Turbopack
  // forced on — which breaks Babel-based Next projects and pins the
  // wrong port. See `src/lib/utils/sanitize-child-env.ts`.
  const sanitized = sanitizeChildEnv(input.env);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(sanitized)) {
    if (typeof v === 'string') env[k] = v;
  }
  // Hint to apps that we're a real interactive xterm — without this,
  // many CLIs render in dumb-terminal mode (no colour, no cursor moves).
  env.TERM = env.TERM ?? 'xterm-256color';
  env.COLORTERM = env.COLORTERM ?? 'truecolor';

  // Spawn a login shell so the user gets the same env as Terminal.app:
  // bash-completion, brew shellenv, nvm, asdf, etc. are typically sourced
  // from `.bash_profile` / `.zprofile`, which only run for login shells.
  // Without `-l`, `cd <tab>` completes files (no bash-completion), `node`
  // points at the wrong version (no nvm), etc.
  const args = process.platform === 'win32' ? [] : ['-l'];

  let proc: nodePty.IPty;
  try {
    proc = nodePty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: input.cwd,
      env,
    });
  } catch (err) {
    // posix_spawnp failures bubble up as plain Errors with no detail
    // about which arg upset the spawn. Log everything we passed in so
    // a dev seeing a 500 has something to act on, then wrap with a
    // human-readable message for the API.
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[pty-manager] spawn failed', {
      shell,
      cwd: input.cwd,
      cols,
      rows,
      reason,
      // Surface the env keys that posix_spawnp is most likely to choke
      // on (PATH, HOME) without dumping the full env to logs.
      PATH: env.PATH ? `${env.PATH.slice(0, 80)}…` : '<unset>',
      HOME: env.HOME ?? '<unset>',
    });
    throw new TerminalSpawnError(
      `Failed to spawn ${shell} in ${input.cwd}: ${reason}`,
      'spawn_failed',
    );
  }

  const t: ManagedTerminal = {
    id,
    sessionId: input.sessionId,
    cwd: input.cwd,
    shell,
    cols,
    rows,
    proc,
    buffer: [],
    bufferBytes: 0,
    exited: false,
    exitCode: null,
    exitSignal: null,
    listeners: new Set(),
    createdAt: new Date().toISOString(),
  };

  proc.onData((data) => {
    appendBuffer(t, data);
    for (const listener of t.listeners) {
      try { listener({ type: 'data', data }); } catch { /* listener errors must not kill the pty */ }
    }
  });

  proc.onExit(({ exitCode, signal }) => {
    t.exited = true;
    t.exitCode = exitCode ?? null;
    t.exitSignal = signal ?? null;
    for (const listener of t.listeners) {
      try { listener({ type: 'exit', code: t.exitCode, signal: t.exitSignal }); } catch { /* */ }
    }
    t.listeners.clear();
  });

  terminals.set(id, t);
  return describe(t);
}

export function listTerminals(sessionId: string): TerminalDescriptor[] {
  const out: TerminalDescriptor[] = [];
  for (const t of terminals.values()) {
    if (t.sessionId === sessionId) out.push(describe(t));
  }
  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out;
}

export function getTerminal(sessionId: string, id: string): TerminalDescriptor | null {
  const t = terminals.get(id);
  if (!t || t.sessionId !== sessionId) return null;
  return describe(t);
}

export function writeInput(sessionId: string, id: string, data: string): boolean {
  const t = terminals.get(id);
  if (!t || t.sessionId !== sessionId || t.exited) return false;
  t.proc.write(data);
  return true;
}

export function resizeTerminal(sessionId: string, id: string, cols: number, rows: number): boolean {
  const t = terminals.get(id);
  if (!t || t.sessionId !== sessionId || t.exited) return false;
  if (cols < 1 || rows < 1) return false;
  t.cols = cols;
  t.rows = rows;
  try {
    t.proc.resize(cols, rows);
  } catch {
    // Resize can race with exit — swallow and keep going.
  }
  return true;
}

export function killTerminal(sessionId: string, id: string): boolean {
  const t = terminals.get(id);
  if (!t || t.sessionId !== sessionId) return false;
  if (!t.exited) {
    try { t.proc.kill(); } catch { /* */ }
  }
  terminals.delete(id);
  return true;
}

export function killAllForSession(sessionId: string): number {
  let n = 0;
  for (const [id, t] of terminals.entries()) {
    if (t.sessionId !== sessionId) continue;
    if (!t.exited) {
      try { t.proc.kill(); } catch { /* */ }
    }
    terminals.delete(id);
    n += 1;
  }
  return n;
}

/**
 * Subscribe to live output. The replay buffer is delivered synchronously
 * before any future chunks land, so a fresh SSE connection sees the
 * recent backlog and then real-time updates without any join race.
 *
 * Returns the unsubscribe function plus the buffer snapshot. Callers
 * that don't want replay can ignore the buffer.
 */
export interface SubscribeResult {
  unsubscribe: () => void;
  replay: string;
  exited: boolean;
  exitCode: number | null;
}

export function subscribe(
  sessionId: string,
  id: string,
  listener: TerminalListener,
): SubscribeResult | null {
  const t = terminals.get(id);
  if (!t || t.sessionId !== sessionId) return null;
  const replay = t.buffer.join('');
  if (!t.exited) t.listeners.add(listener);
  return {
    unsubscribe: () => { t.listeners.delete(listener); },
    replay,
    exited: t.exited,
    exitCode: t.exitCode,
  };
}
