/**
 * The agent browser: connect-or-launch over CDP.
 *
 * The persistent, stateful thing is the browser process itself (its cookies,
 * its tabs). Flow is a thin client that connects to it, it does not own a
 * browser daemon. See docs/browser-capability-proposal.md, section 3.
 *
 * Detection is unambiguous because Flow owns the profile. We launch the chosen
 * Chromium with remote debugging pointed at the agent profile dir, and Chromium
 * writes the live port into `<profile>/DevToolsActivePort`. "Is one open?" is
 * then: read that file, probe `/json/version` on the port. A DevTools response
 * means a browser is open and it is definitively ours, because the port came
 * from our own profile dir.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { ensureBrowserProfileDir, getBrowserProfileDir, ensureBrowserWorkDir } from '@/lib/config/paths';
import { ActionError } from '@/lib/orchestrator/types';
import { resolveChromium } from './chromium';

/** Chromium writes the active DevTools port here inside the user-data-dir. */
const DEVTOOLS_PORT_FILE = 'DevToolsActivePort';
const LAUNCH_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 1_500;

export interface AgentBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export interface OpenOptions {
  /** Headless for unattended runs, headed for interactive login. */
  headless?: boolean;
  /** Named profile. Defaults to the single `agent` profile. */
  profile?: string;
  /** Explicit Chromium executable, else autodetect. */
  executablePath?: string | null;
}

interface PortFile {
  port: number;
  wsPath?: string;
}

function readPortFile(profileDir: string): PortFile | null {
  const file = path.join(profileDir, DEVTOOLS_PORT_FILE);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
  if (!raw) return null;
  const [portLine, wsPath] = raw.split('\n');
  const port = Number(portLine.trim());
  if (!Number.isInteger(port) || port <= 0) return null;
  return { port, wsPath: wsPath?.trim() };
}

function clearPortFile(profileDir: string): void {
  try {
    fs.rmSync(path.join(profileDir, DEVTOOLS_PORT_FILE));
  } catch {
    // already gone
  }
}

// ─── Process ownership: a pidfile so the kill switch is reliable and a locked
// profile can be recovered before relaunch. ─────────────────────────────────

function pidfilePath(profile?: string): string {
  return path.join(ensureBrowserWorkDir(), `${profile ?? 'agent'}.pid`);
}

function writePidfile(profile: string | undefined, pid: number): void {
  try {
    fs.writeFileSync(pidfilePath(profile), String(pid), { mode: 0o600 });
  } catch {
    // best-effort
  }
}

function readPid(profile?: string): number | null {
  try {
    const n = Number(fs.readFileSync(pidfilePath(profile), 'utf8').trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function clearPidfile(profile?: string): void {
  try {
    fs.rmSync(pidfilePath(profile));
  } catch {
    // already gone
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** SIGTERM, wait, then SIGKILL. Returns once the process is gone or unkillable. */
async function killPid(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return; // already gone
  }
  const deadline = Date.now() + 4_000;
  while (pidAlive(pid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (pidAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // gone between checks
    }
  }
}

/** Remove Chromium single-instance lock files left by a crashed session. */
function clearSingletonLocks(profileDir: string): void {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      fs.rmSync(path.join(profileDir, name), { force: true });
    } catch {
      // ignore
    }
  }
}

/**
 * Probe a candidate port. Returns the CDP endpoint URL when a live Chromium
 * DevTools endpoint answers, else null (the port file is stale or foreign).
 */
async function probeEndpoint(port: number): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { webSocketDebuggerUrl?: string };
    // Prefer the exact ws url; the http base also works for connectOverCDP.
    return body.webSocketDebuggerUrl ?? `http://127.0.0.1:${port}`;
  } catch {
    return null;
  }
}

/**
 * The CDP endpoint of a running agent browser on this profile, or null. Clears
 * a stale port file (browser exited or crashed) as a side effect so the next
 * launch starts clean.
 */
export async function getRunningEndpoint(profile?: string): Promise<string | null> {
  const profileDir = getBrowserProfileDir(profile);
  const portFile = readPortFile(profileDir);
  if (!portFile) return null;
  const endpoint = await probeEndpoint(portFile.port);
  if (!endpoint) {
    clearPortFile(profileDir);
    return null;
  }
  return endpoint;
}

/** Whether an agent browser is currently open on this profile. */
export async function isBrowserOpen(profile?: string): Promise<boolean> {
  return (await getRunningEndpoint(profile)) !== null;
}

async function waitForPortFile(profileDir: string, aliveCheck?: () => boolean): Promise<string> {
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const portFile = readPortFile(profileDir);
    if (portFile) {
      const endpoint = await probeEndpoint(portFile.port);
      if (endpoint) return endpoint;
    }
    if (aliveCheck && !aliveCheck()) {
      throw new ActionError(
        'unsupported',
        'The agent browser exited before it became ready.',
        'Run `flow browser doctor` to check the browser install.',
      );
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new ActionError(
    'unsupported',
    'The agent browser did not become ready in time.',
    'Run `flow browser doctor` to check the browser install.',
  );
}

/**
 * Spawn the chosen Chromium detached, pointed at the agent profile, with a
 * DevTools port. Detached + unref so the browser outlives this process, which
 * is what makes it a browser Flow connects to rather than a child it owns.
 */
async function launch(opts: OpenOptions): Promise<string> {
  const resolved = resolveChromium(opts.executablePath);
  if (!resolved) {
    throw new ActionError(
      'unsupported',
      'No Chromium-family browser found (Chrome, Brave, Edge, or Chromium).',
      'Install one, or enable the consented Playwright Chromium download.',
    );
  }
  const profileDir = ensureBrowserProfileDir(opts.profile);

  // Recover a locked profile before launching. If a prior browser is orphaned
  // (holding the single-instance lock but not reachable over CDP), a fresh
  // launch would just forward to it and exit without a usable debug port. Kill
  // the orphan and clear stale locks first.
  const orphanPid = readPid(opts.profile);
  if (orphanPid && pidAlive(orphanPid)) await killPid(orphanPid);
  clearPidfile(opts.profile);
  clearPortFile(profileDir);
  clearSingletonLocks(profileDir);

  const args = [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0', // let Chromium pick, it records the choice in DevToolsActivePort
    '--remote-allow-origins=*', // required for the CDP websocket handshake on recent Chromium
    '--no-first-run',
    '--no-default-browser-check',
    // Suppress navigator.webdriver. Without this, remote-debugging makes Chromium
    // report webdriver=true, which Cloudflare/Medium bot detection blocks on. A real
    // user's browser reports false; this makes ours match so logged-in reads go through.
    '--disable-blink-features=AutomationControlled',
  ];
  if (opts.headless) args.push('--headless=new');

  const child = spawn(resolved.executablePath, args, {
    detached: true,
    stdio: 'ignore',
  });
  let exited = false;
  child.on('error', () => {
    exited = true;
  });
  child.on('exit', () => {
    exited = true;
  });
  child.unref();
  if (child.pid) writePidfile(opts.profile, child.pid);

  return waitForPortFile(profileDir, () => !exited);
}

/**
 * Connect to the agent browser, launching it first if none is open. This is the
 * single entry point every browser action uses. Reads and acts call it
 * transparently, so the browser just appears when the agent needs it.
 */
export async function openOrConnect(opts: OpenOptions = {}): Promise<AgentBrowser> {
  const endpoint = (await getRunningEndpoint(opts.profile)) ?? (await launch(opts));
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  return { browser, context, page };
}

/**
 * The kill switch: close the agent browser and everything in it. Idempotent, a
 * no-op when nothing is open. For a CDP-connected browser, `browser.close()`
 * closes the underlying browser process, not just our connection.
 */
export async function closeBrowser(profile?: string): Promise<{ closed: boolean }> {
  let closed = false;

  // Graceful close over CDP (flushes cookies) when the browser is reachable.
  const endpoint = await getRunningEndpoint(profile);
  if (endpoint) {
    try {
      const browser = await chromium.connectOverCDP(endpoint);
      await browser.close();
      closed = true;
    } catch {
      // fall through to the pid backstop
    }
  }

  // Backstop: make sure the process is actually gone, even if CDP close failed
  // or the browser was orphaned with no reachable endpoint.
  const pid = readPid(profile);
  if (pid && pidAlive(pid)) {
    await killPid(pid);
    closed = true;
  }

  clearPidfile(profile);
  const profileDir = getBrowserProfileDir(profile);
  clearPortFile(profileDir);
  clearSingletonLocks(profileDir);
  return { closed };
}
