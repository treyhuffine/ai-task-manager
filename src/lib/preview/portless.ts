/**
 * Read-only adapter over Portless's on-disk state.
 *
 * Portless owns process lifecycle, port allocation, and TLS for apps the
 * user starts via `portless run`. Flow's job in Portless mode is simply:
 *
 *   1. Detect that Portless is installed and the proxy is running.
 *   2. Read the routing table from `~/.portless/routes.json`.
 *   3. Look up the workspace's hostname → forward our proxy to that port.
 *
 * We never write to Portless's state directory. We never even talk to
 * its TLS proxy — `routes.json` exposes the ephemeral upstream port, so
 * our proxy can hit `http://127.0.0.1:<port>` directly with the correct
 * `Host` header. Bypassing the TLS proxy avoids dealing with Portless's
 * local CA from Node.
 *
 * Format is documented at:
 *   https://github.com/vercel-labs/portless/blob/main/packages/portless/src/routes.ts
 *   https://github.com/vercel-labs/portless/blob/main/packages/portless/src/types.ts
 *
 * `PORTLESS_STATE_DIR` env var overrides the default location (`~/.portless`).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import slugify from '@sindresorhus/slugify';

export interface PortlessRoute {
  hostname: string;
  port: number;
  pid: number;
  tailscaleUrl?: string;
  tailscaleHttpsPort?: number;
  tailscaleFunnel?: boolean;
}

export interface PortlessStatus {
  /** Has the state dir been initialized (at least once)? */
  installed: boolean;
  /** Is the proxy daemon currently running? */
  proxyRunning: boolean;
  /** Absolute path to the state directory in effect. */
  stateDir: string;
}

const ROUTES_FILENAME = 'routes.json';
const PROXY_PID_FILENAME = 'proxy.pid';
const READ_RETRY_DELAY_MS = 10;

export function getPortlessStateDir(): string {
  const override = process.env.PORTLESS_STATE_DIR;
  if (override && override.trim()) return override;
  return path.join(os.homedir(), '.portless');
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function detectInternal(): PortlessStatus {
  const stateDir = getPortlessStateDir();
  if (!fs.existsSync(stateDir)) {
    return { installed: false, proxyRunning: false, stateDir };
  }
  let proxyRunning = false;
  try {
    const pidStr = fs.readFileSync(path.join(stateDir, PROXY_PID_FILENAME), 'utf-8').trim();
    const pid = Number(pidStr);
    if (Number.isFinite(pid) && pid > 0 && isAlive(pid)) {
      proxyRunning = true;
    }
  } catch {
    // No pid file or unreadable — proxy isn't running.
  }
  return { installed: true, proxyRunning, stateDir };
}

// Cached detection — Portless state doesn't change frequently. The cache
// is invalidated by the file watcher (`startWatcher`) whenever routes.json
// changes, and by an explicit `invalidateDetectCache()` helper if anyone
// wants a forced refresh. 10s ceiling so stale assumptions self-heal.
let detectCache: { at: number; value: PortlessStatus } | null = null;
const DETECT_TTL_MS = 10_000;

export function detectPortless(): PortlessStatus {
  const now = Date.now();
  if (detectCache && now - detectCache.at < DETECT_TTL_MS) {
    return detectCache.value;
  }
  const value = detectInternal();
  detectCache = { at: now, value };
  return value;
}

export function invalidateDetectCache(): void {
  detectCache = null;
}

function readRoutesOnce(): PortlessRoute[] {
  const file = path.join(getPortlessStateDir(), ROUTES_FILENAME);
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRoute);
  } catch {
    return [];
  }
}

function isValidRoute(value: unknown): value is PortlessRoute {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return typeof r.hostname === 'string' && typeof r.port === 'number' && typeof r.pid === 'number';
}

/**
 * Read the route table. Tolerant of a concurrent write by Portless: if
 * the first parse fails, sleep 10ms and try once more before giving up.
 * Returns dead-PID routes too — the caller filters as needed.
 */
export function readRoutes(): PortlessRoute[] {
  const first = readRoutesOnce();
  if (first.length > 0) return first;
  // The file is either empty, missing, or was mid-write. One retry covers
  // the mid-write case without making us wait for a full event loop tick.
  const start = Date.now();
  while (Date.now() - start < READ_RETRY_DELAY_MS) { /* spin briefly */ }
  return readRoutesOnce();
}

/**
 * Find a route by hostname. Filters out dead PIDs so we don't proxy at
 * a phantom port that's since been recycled.
 */
export function findRoute(hostname: string): PortlessRoute | null {
  const all = readRoutes();
  for (const r of all) {
    if (r.hostname !== hostname) continue;
    if (r.pid !== 0 && !isAlive(r.pid)) continue;
    return r;
  }
  return null;
}

// ─── Watcher ──────────────────────────────────────────────────────────

type Listener = (routes: PortlessRoute[]) => void;

interface WatcherState {
  watcher: fs.FSWatcher | null;
  snapshot: PortlessRoute[];
  listeners: Set<Listener>;
  debounceTimer: NodeJS.Timeout | null;
  stateDir: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __flowPortlessWatcher: WatcherState | undefined;
}

function ensureWatcher(): WatcherState {
  if (globalThis.__flowPortlessWatcher) return globalThis.__flowPortlessWatcher;

  const stateDir = getPortlessStateDir();
  const state: WatcherState = {
    watcher: null,
    snapshot: [],
    listeners: new Set(),
    debounceTimer: null,
    stateDir,
  };
  globalThis.__flowPortlessWatcher = state;

  // Initial snapshot.
  state.snapshot = readRoutes();

  // Lazy watcher creation — only attach when there's at least one
  // listener. Avoids a stray fs.watch on machines that don't have
  // Portless installed.
  return state;
}

function startFsWatchIfNeeded(state: WatcherState): void {
  if (state.watcher) return;
  try {
    // `fs.watch` against a directory we may not have created yet would
    // throw. The state directory is created on Portless's first run, so
    // skip watching when it doesn't exist; `detectPortless()` polling
    // will catch up if Portless gets installed later.
    if (!fs.existsSync(state.stateDir)) return;
    state.watcher = fs.watch(state.stateDir, (_event, filename) => {
      if (filename && filename !== ROUTES_FILENAME) return;
      if (state.debounceTimer) clearTimeout(state.debounceTimer);
      state.debounceTimer = setTimeout(() => {
        state.snapshot = readRoutes();
        invalidateDetectCache();
        for (const l of state.listeners) {
          try { l(state.snapshot); } catch { /* listener bug — don't break others */ }
        }
      }, 50);
    });
    state.watcher.on('error', (err) => {
      console.warn('[portless] watcher error:', err);
    });
  } catch (err) {
    console.warn('[portless] could not start watcher:', err);
  }
}

function stopFsWatchIfIdle(state: WatcherState): void {
  if (state.listeners.size > 0) return;
  if (state.watcher) {
    state.watcher.close();
    state.watcher = null;
  }
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
}

/**
 * Subscribe to changes in `routes.json`. The callback is fired (debounced
 * 50ms) on every change, and once immediately on subscription with the
 * current snapshot. Returns an unsubscribe function.
 */
export function startWatcher(onChange: Listener): () => void {
  const state = ensureWatcher();
  state.listeners.add(onChange);
  startFsWatchIfNeeded(state);
  // Fire once with current snapshot so consumers don't need to poll for
  // the initial state.
  queueMicrotask(() => {
    try { onChange(state.snapshot); } catch { /* swallow */ }
  });
  return () => {
    state.listeners.delete(onChange);
    stopFsWatchIfIdle(state);
  };
}

/** Read the current snapshot without subscribing. */
export function getRoutesSnapshot(): PortlessRoute[] {
  return ensureWatcher().snapshot;
}

// ─── Hostname derivation ───────────────────────────────────────────────

/**
 * Mirror Portless's own derivation so Flow + Portless agree without
 * coordination:
 *
 *   - Main worktree:   `<slug>`
 *   - Linked worktree: `<branch>.<slug>` (branch sanitized — `/` → `-`)
 *
 * The slug is the workspace.slug (already DNS-safe by virtue of `slugify()`).
 * For non-git workspaces, the branch is ignored.
 */
export function derivePortlessHostname(input: {
  slug: string;
  worktreeBranch?: string | null;
}): string {
  const base = input.slug || 'app';
  if (!input.worktreeBranch) return base;
  const branch = sanitizeBranch(input.worktreeBranch);
  if (!branch) return base;
  return `${branch}.${base}`;
}

function sanitizeBranch(branch: string): string {
  // Portless replaces `/` with `-` and slugifies. Match that.
  return slugify(branch.replace(/\//g, '-'));
}
