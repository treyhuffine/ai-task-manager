/**
 * Thin wrapper over the bundled `beamd` binary. Every call goes through
 * `--config <beamd.yaml>` (the automation path) and `--json`.
 *
 * Binary resolution, in order:
 *   1. An explicit override set via `setBeamdBinOverride()` (from settings).
 *   2. `FLOW_BEAMD_BIN` env (used for local dev against an unpublished build).
 *   3. `require.resolve('@beamd/cli/bin/beamd.cjs')` — the published package's
 *      Node shim, run via the current `node`.
 *   4. `beamd` on `PATH`.
 *
 * `open -d` (detached) is the only path Flow uses to bring a tunnel up: it
 * hands the tunnel to a background agent and returns immediately. The agent
 * survives this process exiting; later `close`/`list`/`status` reconnect to
 * it via the isolated `agent_socket` pinned in the config.
 */

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { getBeamdConfigPath } from './config';

const require = createRequire(import.meta.url);

let binOverride: string | null = null;

/** Point the wrapper at a specific `beamd` binary (from preview settings). */
export function setBeamdBinOverride(binPath: string | null): void {
  binOverride = binPath && binPath.trim() ? binPath.trim() : null;
}

interface ResolvedBin {
  command: string;
  /** Args that precede the beamd args (e.g. the shim path when run via node). */
  prefixArgs: string[];
}

function resolveBeamdBin(): ResolvedBin {
  if (binOverride) return { command: binOverride, prefixArgs: [] };
  const envBin = process.env.FLOW_BEAMD_BIN?.trim();
  if (envBin) return { command: envBin, prefixArgs: [] };
  try {
    const shim = require.resolve('@beamd/cli/bin/beamd.cjs');
    return { command: process.execPath, prefixArgs: [shim] };
  } catch {
    return { command: 'beamd', prefixArgs: [] };
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
  const fullArgs = [...prefixArgs, ...args, '--config', getBeamdConfigPath()];
  return new Promise((resolve) => {
    execFile(command, fullArgs, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const exitCode = err && typeof (err as { code?: unknown }).code === 'number'
        ? (err as { code: number }).code
        : err ? null : 0;
      if (err && (err as { code?: unknown }).code === 'ENOENT') {
        resolve({ stdout: '', stderr: `beamd binary not found (${command})`, exitCode: null });
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
  if (text.includes('binary not found')) {
    code = 'beamd_not_installed';
    message = 'The beamd binary was not found. Install @beamd/cli or set FLOW_BEAMD_BIN.';
  } else if (text.includes('agent not available') || text.includes('agent did not start')) {
    code = 'beamd_agent_down';
    message = 'Could not reach the beamd edge (the tunnel agent failed to start). Check the server and token in preview settings.';
  } else if (text.includes('unauthorized') || text.includes('invalid token') || text.includes('forbidden') || text.includes('401') || text.includes('403')) {
    code = 'beamd_unauthorized';
    message = 'beamd rejected the token. Re-enter the server and token in preview settings.';
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

/**
 * Stop + respawn the background agent so a changed server/token takes effect
 * (a long-lived agent caches creds for its lifetime). Best-effort; call after
 * rewriting the config on a credential change. beamd 0.0.2+.
 */
export async function beamdReload(timeoutMs = 10_000): Promise<void> {
  const res = await run(['reload'], timeoutMs);
  if (res.exitCode !== 0) throw classifyError(res);
}

export async function beamdStatus(timeoutMs = 8_000): Promise<BeamdStatusResult> {
  const res = await run(['status', '--json'], timeoutMs);
  // status prints a JSON object even when unhealthy (exit 0). Validate the
  // shape so a non-zero exit with partial/garbage JSON can't be mistaken for
  // a healthy reading (the "Test connection" path is where users debug).
  const result = parseJson<Partial<BeamdStatusResult>>(res);
  if (typeof result.healthy !== 'boolean' || typeof result.agentRunning !== 'boolean') {
    throw classifyError(res);
  }
  return result as BeamdStatusResult;
}
