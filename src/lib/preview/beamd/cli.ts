/**
 * Thin wrapper over the bundled `beamd` binary.
 *
 * Flow is **just another beamd client on the machine** — it does NOT manage
 * credentials or pass `--config`. Every call resolves the machine's beamd
 * account from `~/.beamd/` (set up once via `beamd login`), exactly like the
 * human at a terminal and the agent in a worktree. One credential, one path.
 *
 * Binary resolution, in order:
 *   1. `FLOW_BEAMD_BIN` env (local dev against an unpublished build).
 *   2. the native per-platform binary from `@beamd/cli` (the normal path).
 *   3. `@beamd/cli/bin/beamd.cjs` shim via `node`.
 *   4. `beamd` on `PATH`.
 */

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

interface ResolvedBin {
  command: string;
  /** Args that precede the beamd args (e.g. the shim path when run via node). */
  prefixArgs: string[];
}

/** An explicit path: a `.js`/`.cjs`/`.mjs` runs under node; anything else is
 *  a native binary we exec directly. Guards against a misconfigured path
 *  turning into `node <bogus>` (which surfaces as a cryptic MODULE_NOT_FOUND). */
function fromExplicitPath(p: string): ResolvedBin {
  if (/\.(c|m)?js$/i.test(p)) return { command: process.execPath, prefixArgs: [p] };
  return { command: p, prefixArgs: [] };
}

function resolveBeamdBin(): ResolvedBin {
  const envBin = process.env.FLOW_BEAMD_BIN?.trim();
  if (envBin) return fromExplicitPath(envBin);

  // Prefer the native per-platform binary, resolved relative to @beamd/cli.
  // Exec it directly — no `node`, no JS shim — which is both faster and
  // avoids the whole "node was handed a bad entry script" failure class.
  try {
    const base = require.resolve('@beamd/cli/package.json');
    const platformPkg = `@beamd/cli-${process.platform}-${process.arch}`;
    const nativeBin = require.resolve(`${platformPkg}/bin/beamd`, { paths: [path.dirname(base)] });
    return { command: nativeBin, prefixArgs: [] };
  } catch {
    // Fall through to the JS shim (run under node) if the native package
    // isn't resolvable (unusual — e.g. a partial install).
  }
  try {
    const shim = require.resolve('@beamd/cli/bin/beamd.cjs');
    return { command: process.execPath, prefixArgs: [shim] };
  } catch {
    return { command: 'beamd', prefixArgs: [] }; // last resort: PATH
  }
}

export class BeamdCliError extends Error {
  readonly code: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  constructor(code: string, message: string, stderr: string, exitCode: number | null) {
    super(message);
    this.name = 'BeamdCliError';
    this.code = code;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function run(args: string[], timeoutMs: number): Promise<RunResult> {
  const { command, prefixArgs } = resolveBeamdBin();
  const fullArgs = [...prefixArgs, ...args];
  return new Promise((resolve) => {
    execFile(command, fullArgs, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const errCode = (err as { code?: unknown } | null)?.code;
      const exitCode = typeof errCode === 'number' ? errCode : err ? null : 0;
      // The binary couldn't be launched at all (missing/not executable, or a
      // misconfigured path node choked on). Normalize to a clean "not
      // installed" signal instead of leaking a raw node stack to the client.
      const launchFailed =
        errCode === 'ENOENT' ||
        (err && typeof (err as { message?: unknown }).message === 'string' &&
          /cannot find module|not found|no such file|spawn/i.test((err as { message: string }).message));
      if (launchFailed) {
        console.error(`[beamd] launch failed for "${command}":`, (err as Error)?.message);
        resolve({ stdout: '', stderr: `beamd binary could not be launched (${command})`, exitCode: null });
        return;
      }
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode });
    });
  });
}

/** Map a failed beamd run to a stable, actionable error code. */
function classifyError(res: RunResult): BeamdCliError {
  const text = `${res.stdout}\n${res.stderr}`.toLowerCase();
  let code = 'beamd_error';
  let message = (res.stderr || res.stdout || 'beamd command failed').trim();
  if (text.includes('could not be launched') || text.includes('binary not found') || text.includes('cannot find module')) {
    code = 'beamd_not_installed';
    message = 'The beamd binary could not be launched. Reinstall @beamd/cli.';
  } else if (text.includes('not logged in') || text.includes('no account') || text.includes('no profile') || text.includes('run `beamd login`') || text.includes('run beamd login')) {
    code = 'beamd_not_connected';
    message = 'This machine isn’t connected to beamd. Connect it to enable remote previews.';
  } else if (text.includes('agent not available') || text.includes('agent did not start')) {
    code = 'beamd_agent_down';
    message = 'Could not reach the beamd edge (the tunnel agent failed to start). Check that this machine is connected to beamd.';
  } else if (text.includes('unauthorized') || text.includes('invalid token') || text.includes('forbidden') || text.includes('401') || text.includes('403')) {
    code = 'beamd_unauthorized';
    message = 'beamd rejected the credentials. Reconnect this machine to beamd.';
  } else if (text.includes('max_tunnels') || text.includes('tunnel cap') || text.includes('too many tunnels')) {
    code = 'beamd_tunnel_cap';
    message = 'The beamd tunnel cap was hit. Close some previews and try again.';
  }
  return new BeamdCliError(code, message, res.stderr, res.exitCode);
}

function parseJson<T>(res: RunResult): T {
  const trimmed = res.stdout.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw classifyError(res);
  }
}

export interface BeamdOpenResult {
  url: string;
  name: string;
  port: number;
  slug: string;
  baseDomain: string;
}

export interface BeamdStatusResult {
  profile: string;
  agentRunning: boolean;
  server: string;
  slug: string;
  healthy: boolean;
}

export interface BeamdListEntry {
  name: string;
  url: string;
  port: number;
  healthy: boolean;
}

/**
 * Bring a tunnel up (detached). Returns the authoritative `url` from beamd —
 * never assemble it (flat vs namespaced edge differ). Idempotent on the
 * beamd side: re-opening the same name returns the live tunnel.
 */
export async function beamdOpen(port: number, name: string, timeoutMs = 25_000): Promise<BeamdOpenResult> {
  const res = await run(['open', String(port), '--as', name, '-d', '--json'], timeoutMs);
  if (res.exitCode !== 0) throw classifyError(res);
  return parseJson<BeamdOpenResult>(res);
}

/** Tear a tunnel down. Idempotent — exit 0 whether or not it existed. */
export async function beamdClose(name: string, timeoutMs = 10_000): Promise<{ name: string; removed: boolean }> {
  const res = await run(['close', name, '--json'], timeoutMs);
  if (res.exitCode !== 0) throw classifyError(res);
  return parseJson<{ name: string; removed: boolean }>(res);
}

export async function beamdList(timeoutMs = 8_000): Promise<BeamdListEntry[]> {
  const res = await run(['list', '--json'], timeoutMs);
  if (res.exitCode !== 0) throw classifyError(res);
  return parseJson<BeamdListEntry[]>(res);
}

export interface BeamdCheckResult {
  ok: boolean;
  server: string;
  slug: string;
  baseDomain: string;
}

/**
 * Authenticate against the edge and report reachability **without**
 * registering a tunnel or spawning the persistent agent (beamd 0.0.2+). The
 * right primitive for "Test connection" — unlike `status`, a valid config
 * returns `ok:true` even on first setup.
 */
export async function beamdCheck(timeoutMs = 12_000): Promise<BeamdCheckResult> {
  const res = await run(['check', '--json'], timeoutMs);
  if (res.exitCode !== 0 && !res.stdout.trim().startsWith('{')) throw classifyError(res);
  const result = parseJson<Partial<BeamdCheckResult>>(res);
  if (result.ok !== true) {
    throw new BeamdCliError(
      res.exitCode === 0 ? 'beamd_unauthorized' : 'beamd_error',
      'beamd could not authenticate with the configured server and token.',
      res.stderr,
      res.exitCode,
    );
  }
  return result as BeamdCheckResult;
}

export async function beamdStatus(timeoutMs = 8_000): Promise<BeamdStatusResult> {
  const res = await run(['status', '--json'], timeoutMs);
  // status prints a JSON object even when unhealthy (exit 0). Validate the
  // shape so a non-zero exit with partial/garbage JSON can't be mistaken for
  // a healthy reading.
  const result = parseJson<Partial<BeamdStatusResult>>(res);
  if (typeof result.healthy !== 'boolean' || typeof result.agentRunning !== 'boolean') {
    throw classifyError(res);
  }
  return result as BeamdStatusResult;
}

/**
 * Connect this machine to a beamd edge — writes `~/.beamd/` via `beamd login`
 * (the same store the human + agent use). `token` is the copy-paste flow
 * (an API key or OSS token); omit it for the interactive device-code flow
 * (not usable headlessly — Flow always passes a token).
 */
export async function beamdLogin(
  opts: { server: string; token: string; insecure?: boolean },
  timeoutMs = 15_000,
): Promise<void> {
  const args = ['login', '--server', opts.server, '--token', opts.token];
  if (opts.insecure) args.push('--insecure');
  const res = await run(args, timeoutMs);
  if (res.exitCode !== 0) throw classifyError(res);
}

/** Disconnect this machine — drops the beamd account from `~/.beamd/`. */
export async function beamdLogout(timeoutMs = 8_000): Promise<void> {
  await run(['logout'], timeoutMs); // idempotent; ignore exit (nothing to drop is fine)
}

/**
 * The edge this machine is connected to, or null if not connected. Cheap —
 * `status` reads local state without authenticating. The basis for the
 * "connected?" signal in settings + the BeamdProvider's readiness check.
 */
export async function beamdConnectedServer(): Promise<string | null> {
  try {
    const status = await beamdStatus();
    return status.server?.trim() ? status.server : null;
  } catch {
    return null;
  }
}
