/**
 * Claude Code CLI auth helper.
 *
 * Drives the inline "Log in to Claude" flow that fires when an
 * `auth_required` event lands in a chat session. Three responsibilities:
 *
 *   1. `getClaudeAuthStatus` — ground-truth probe via `claude auth status`,
 *      which prints JSON ({"loggedIn": true|false, "email": ..., ...}). The
 *      authoritative source for "is the local credential still valid";
 *      reads the same `~/.claude/.credentials.json` the streaming CLI
 *      processes consume.
 *
 *   2. `startClaudeLogin` — spawn `claude auth login --claudeai` as a
 *      detached child. It opens the user's browser for OAuth and prints
 *      progress to its own stdio. We don't wait on it directly because
 *      Claude exec'd from a non-TTY can take a while and we want the API
 *      route to return promptly.
 *
 *   3. `waitForClaudeLogin` — polls `getClaudeAuthStatus` until
 *      `loggedIn: true` or timeout. Dedup'd via globalThis so concurrent
 *      callers join the same in-flight watcher rather than spawning N
 *      probes.
 *
 * The agentex `isLoggedIn`/`loginCommandFor` exist and are reasonable for
 * presence-check sugar, but `claude auth status` JSON is more specific:
 * it returns the email + subscription type, which we surface in the
 * success event. We stick with the direct CLI here.
 */

import { spawn } from 'node:child_process';

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  orgId?: string;
  orgName?: string;
  subscriptionType?: string;
}

/**
 * Spawn `claude auth status` and return parsed JSON. Returns
 * `{ loggedIn: false }` for any failure mode (binary missing, parse
 * failure, non-zero exit) so callers don't have to distinguish — they
 * either have a logged-in user or they don't.
 */
export async function getClaudeAuthStatus(): Promise<ClaudeAuthStatus> {
  return new Promise((resolve) => {
    const proc = spawn('claude', ['auth', 'status'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    // Don't buffer stderr; non-zero exit just returns loggedIn:false.

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* best-effort */ }
      resolve({ loggedIn: false });
    }, 10_000);

    proc.on('error', () => {
      clearTimeout(timer);
      resolve({ loggedIn: false });
    });

    proc.on('exit', () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout) as ClaudeAuthStatus;
        resolve(parsed);
      } catch {
        resolve({ loggedIn: false });
      }
    });
  });
}

/**
 * In-process state for the active login attempt. Stashed on globalThis so
 * concurrent route handlers (and HMR in dev) share one watcher. Resolves
 * when the polling loop sees `loggedIn: true`, rejects on timeout.
 */
interface LoginWatcher {
  promise: Promise<ClaudeAuthStatus>;
  startedAt: number;
}

const WATCHER_KEY = Symbol.for('@flow/claude-login-watcher');
const globalRef = globalThis as unknown as { [WATCHER_KEY]?: LoginWatcher };

/**
 * Spawn `claude auth login --claudeai` detached from this process. Claude
 * opens the user's browser for the OAuth flow. We don't await the child —
 * the login can take several minutes if the user gets distracted, and we
 * want the originating HTTP request to return fast. Recovery happens via
 * `waitForClaudeLogin` polling the status file the child writes on
 * success.
 *
 * Sets the child's `detached: true` so it survives if the Node parent
 * restarts (e.g. HMR) — Claude's OAuth callback still completes and
 * writes credentials to `~/.claude/.credentials.json` either way.
 */
export function startClaudeLogin(): void {
  // `claude auth login` already validates auth state and short-circuits if
  // already logged in, so no need to gate it from here. The spawned
  // process opens the browser via the OS's default handler.
  const proc = spawn('claude', ['auth', 'login', '--claudeai'], {
    stdio: 'ignore',
    detached: true,
  });
  // Allow the parent Node process to exit even if the child is still
  // running. Without this, a graceful shutdown would hang.
  proc.unref();
  proc.on('error', () => { /* swallowed — wait loop reports failures */ });
}

/**
 * Poll `getClaudeAuthStatus` until `loggedIn: true` or timeout. Concurrent
 * calls (multiple browser tabs hitting the login button) share one
 * underlying watcher — the first call starts the poll loop and subsequent
 * calls await the same promise.
 *
 * Default 5-minute timeout matches Claude's OAuth flow ceiling; the user
 * can always retry if they were AFK longer.
 */
export async function waitForClaudeLogin(opts?: {
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<ClaudeAuthStatus> {
  const existing = globalRef[WATCHER_KEY];
  if (existing) return existing.promise;

  const timeoutMs = opts?.timeoutMs ?? 5 * 60_000;
  const intervalMs = opts?.intervalMs ?? 750;
  const deadline = Date.now() + timeoutMs;

  const promise = (async () => {
    try {
      // Fast path: maybe the user just logged in in another tab.
      const initial = await getClaudeAuthStatus();
      if (initial.loggedIn) return initial;

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, intervalMs));
        const status = await getClaudeAuthStatus();
        if (status.loggedIn) return status;
      }
      throw new Error('Timed out waiting for Claude login');
    } finally {
      // Clear the watcher slot so the next call can start fresh — even
      // on success: a future expiry needs to be able to spin up its own
      // login flow.
      delete globalRef[WATCHER_KEY];
    }
  })();

  globalRef[WATCHER_KEY] = { promise, startedAt: Date.now() };
  return promise;
}
