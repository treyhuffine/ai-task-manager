/**
 * Thin wrapper over the bundled `beamd` binary.
 *
 * Flow is **just another beamd client on the machine** — it does NOT manage
 * credentials or pass `--config`. Every call resolves the machine's beamd
 * account from `~/.beamd/` (set up once via `beamd login`), exactly like the
 * human at a terminal and the agent in a worktree. One credential, one path.
 *
 * Binary resolution, in order:
 *   1. `FLOW_BEAMD_BIN` env (explicit override; local dev / escape hatch).
 *   2. a user-installed `beamd` on `PATH` (NOT a `node_modules/.bin` shim) —
 *      preferred so Flow reads the shared `~/.beamd` store with the same CLI
 *      the human + agent use. The store's on-disk format tracks the NEWEST CLI
 *      that writes it, and an older CLI can't read a newer store (a bundled
 *      0.0.2 chokes on a 0.0.3 account file), so deferring to the user's own
 *      beamd avoids a silent misread. See `findExternalBeamdOnPath`.
 *   3. the native per-platform binary bundled via `@beamd/cli`.
 *   4. `@beamd/cli/bin/beamd.cjs` shim via `node`.
 *   5. `beamd` on `PATH` (last resort).
 */

import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// `@beamd/cli` ships as a dependency of Flow, so the per-platform native binary
// installs automatically — no global install, no npx. We locate it from a
// *literal* specifier (`@beamd/cli/package.json`, externalized via
// serverExternalPackages so the bundler leaves it alone) and then find the
// binary beside it with `fs`. We deliberately do NOT do a dynamic
// `require.resolve('@beamd/cli-<os>-<arch>')`: bundlers (webpack + Turbopack)
// statically analyze require/resolve specifiers and fail to resolve the
// optional platform package at build time, even though Node resolves it fine
// at runtime. fs-by-path sidesteps that entirely.
const nodeRequire = createRequire(import.meta.url);

/** Where a resolved binary came from — surfaced in diagnostics + skew messaging. */
export type BeamdBinSource = 'env' | 'path' | 'bundled-native' | 'bundled-shim' | 'fallback';

interface ResolvedBin {
  command: string;
  /** Args that precede the beamd args (e.g. the shim path when run via node). */
  prefixArgs: string[];
  source: BeamdBinSource;
  /** The beamd entry actually invoked (binary or shim), for display. */
  binPath: string;
}

/** An explicit path: a `.js`/`.cjs`/`.mjs` runs under node; anything else is
 *  a native binary we exec directly. Guards against a misconfigured path
 *  turning into `node <bogus>` (which surfaces as a cryptic MODULE_NOT_FOUND). */
function fromExplicitPath(p: string, source: BeamdBinSource): ResolvedBin {
  if (/\.(c|m)?js$/i.test(p)) return { command: process.execPath, prefixArgs: [p], source, binPath: p };
  return { command: p, prefixArgs: [], source, binPath: p };
}

function existsSyncSafe(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function realpathSafe(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * The first `beamd` on PATH that is *not* Flow's own bundled copy — i.e. a
 * beamd the user installed themselves (global npm/pnpm, Homebrew, nvm bin…).
 *
 * We deliberately skip `node_modules/.bin` shim dirs (every Flow install
 * carries one via the `@beamd/cli` dependency, and pnpm even puts it on PATH
 * during `pnpm dev`) and anything resolving into the bundled cli package, so
 * this returns only a *separate*, user-controlled binary. Preferring it keeps
 * Flow reading the shared `~/.beamd` store with the same CLI version that wrote
 * it (an older CLI can't parse a newer store — that's the whole skew bug).
 */
function findExternalBeamdOnPath(bundledCliDir: string | null): string | null {
  const rawPath = process.env.PATH;
  if (!rawPath) return null;
  const names = process.platform === 'win32' ? ['beamd.exe', 'beamd.cmd', 'beamd.bat', 'beamd'] : ['beamd'];
  const bundledReal = bundledCliDir ? realpathSafe(bundledCliDir) + path.sep : null;
  for (const dir of rawPath.split(path.delimiter)) {
    if (!dir) continue;
    if (path.basename(dir) === '.bin') continue; // per-project shim dir — that's the bundled copy
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (!fs.statSync(candidate).isFile()) continue; // follows symlinks; skips dirs
        fs.accessSync(candidate, fs.constants.X_OK);
      } catch {
        continue;
      }
      // Exclude anything that resolves into the bundled cli package.
      if (bundledReal && realpathSafe(candidate).startsWith(bundledReal)) continue;
      return candidate;
    }
  }
  return null;
}

function resolveBeamdBin(): ResolvedBin {
  const envBin = process.env.FLOW_BEAMD_BIN?.trim();
  if (envBin) return fromExplicitPath(envBin, 'env');

  let cliDir: string | null = null;
  try {
    cliDir = path.dirname(nodeRequire.resolve('@beamd/cli/package.json'));
  } catch {
    cliDir = null;
  }

  // Prefer a user-installed beamd over Flow's bundled copy so we read the shared
  // store the same way the human + agent wrote it (avoids the version-skew
  // misread). The bundle below is the zero-install fallback.
  const externalBin = findExternalBeamdOnPath(cliDir);
  if (externalBin) return fromExplicitPath(externalBin, 'path');

  if (cliDir) {
    const platformPkg = `@beamd/cli-${process.platform}-${process.arch}`;
    // Prefer the native per-platform binary, exec'd directly — no `node`, no
    // JS shim — which is faster and avoids the "node handed a bad entry
    // script" failure class. Check the layouts pnpm and npm produce.
    const nativeCandidates = [
      path.join(cliDir, '..', platformPkg, 'bin', 'beamd'),                       // sibling (pnpm .pnpm / npm hoisted)
      path.join(cliDir, 'node_modules', '@beamd', platformPkg, 'bin', 'beamd'),   // nested under cli's own deps
    ];
    for (const candidate of nativeCandidates) {
      if (existsSyncSafe(candidate)) return { command: candidate, prefixArgs: [], source: 'bundled-native', binPath: candidate };
    }
    // Fall back to the JS shim (run under node) — it locates the binary
    // itself, so it works even on a partial / unexpected layout.
    const shim = path.join(cliDir, 'bin', 'beamd.cjs');
    if (existsSyncSafe(shim)) return { command: process.execPath, prefixArgs: [shim], source: 'bundled-shim', binPath: shim };
  }

  return { command: 'beamd', prefixArgs: [], source: 'fallback', binPath: 'beamd' }; // last resort: PATH
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

function run(args: string[], timeoutMs: number, cwd?: string): Promise<RunResult> {
  const { command, prefixArgs } = resolveBeamdBin();
  const fullArgs = [...prefixArgs, ...args];
  return new Promise((resolve) => {
    // `cwd` lets beamd resolve a project-local `beamd.yaml` (edge + scope) by
    // walking up from the worktree — passed for the tunnel lifecycle so a
    // preview lands in the org/scope the project pins. Undefined = process cwd.
    execFile(command, fullArgs, { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
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
  } else if (
    // The resolved beamd is OLDER than the CLI that set up `~/.beamd`, so it
    // can't read the account written in a newer on-disk format. Make this
    // legible instead of surfacing as a silent "not connected".
    text.includes('invalid profile name') ||
    text.includes('must be a simple name') ||
    text.includes('unsupported config version') ||
    text.includes('unknown config version') ||
    text.includes('unrecognized account')
  ) {
    code = 'beamd_cli_outdated';
    message =
      "Flow's beamd is older than the beamd that set up this machine, so it can't read the account. " +
      'Update Flow (or install a current beamd, Flow will use it), or set FLOW_BEAMD_BIN to your beamd binary.';
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
 *
 * `cwd` is the worktree dir — beamd resolves the project's `beamd.yaml` (edge +
 * scope) from it, so the tunnel lands in the org the project pins. `list`/
 * `close` take the same `cwd` so reuse + teardown hit that same scope.
 */
export async function beamdOpen(
  port: number,
  name: string,
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<BeamdOpenResult> {
  const res = await run(['open', String(port), '--as', name, '-d', '--json'], opts.timeoutMs ?? 25_000, opts.cwd);
  if (res.exitCode !== 0) throw classifyError(res);
  return parseJson<BeamdOpenResult>(res);
}

/** Tear a tunnel down. Idempotent — exit 0 whether or not it existed. Pass the
 *  worktree `cwd` so it resolves the same project `beamd.yaml` scope `open` used. */
export async function beamdClose(
  name: string,
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ name: string; removed: boolean }> {
  const res = await run(['close', name, '--json'], opts.timeoutMs ?? 10_000, opts.cwd);
  if (res.exitCode !== 0) throw classifyError(res);
  return parseJson<{ name: string; removed: boolean }>(res);
}

/** List live tunnels. Pass the worktree `cwd` so it lists the project `beamd.yaml`
 *  scope (matching `open`), or reuse-detection would miss a scoped tunnel. */
export async function beamdList(opts: { cwd?: string; timeoutMs?: number } = {}): Promise<BeamdListEntry[]> {
  const res = await run(['list', '--json'], opts.timeoutMs ?? 8_000, opts.cwd);
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
 * Connect this machine to a beamd edge with a token — writes `~/.beamd/` via
 * `beamd login` (the same store the human + agent use). `token` is the
 * copy-paste flow (an API key or OSS token). For the browser-approve flow
 * (no token), see {@link beamdLoginDevice}.
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

/** The browser-approval challenge — shown to the user so they can approve. */
export interface BeamdDevicePending {
  verificationUri: string;
  verificationUriComplete: string;
  userCode: string;
  expiresIn: number;
  interval: number;
}

/**
 * Device-code (browser-approve) login — the hosted on-ramp.
 *
 * Drives the *interactive* `beamd login` (omit `--token`): even with piped
 * stdio (no TTY) it prints a verification URL + user code and blocks on
 * "Waiting for confirmation…", then exits 0 once approved (credential written
 * to `~/.beamd/`) or non-zero on expiry/denial. We scrape the URL + code out of
 * its output and relay them via `onPending` so the UI can show them; the
 * terminal signal is the process **exit code** (not a parsed success string —
 * robust to copy changes). Resolves when the login completes (exit 0).
 *
 * Failure *before* a challenge is shown → `beamd_device_unsupported` (an
 * OSS/static-token edge that doesn't offer device-code, or an unreachable
 * edge), so the caller falls back to the API-key form. Failure *after* →
 * `beamd_device_expired`. Abort via `signal` → `beamd_device_aborted`. `server`
 * is optional — omitted, beamd targets its hosted default edge. Nothing is
 * persisted unless the flow reaches exit 0.
 *
 * (When beamd ships a headless `login --device --json` NDJSON mode — see
 * docs/beamd-device-code-contract.md — this can swap to parsing that for
 * robustness; the caller contract is unchanged.)
 */
export async function beamdLoginDevice(
  opts: { server?: string; insecure?: boolean; signal?: AbortSignal },
  onPending: (p: BeamdDevicePending) => void,
): Promise<void> {
  const { command, prefixArgs } = resolveBeamdBin();
  // Interactive device-code login = `beamd login` with NO `--token`.
  const args = [...prefixArgs, 'login'];
  if (opts.server?.trim()) args.push('--server', opts.server.trim());
  if (opts.insecure) args.push('--insecure');

  return await new Promise<void>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(new BeamdCliError('beamd_device_unsupported', 'Could not start browser approval.', String(e), null));
      return;
    }

    let settled = false;
    let pendingSent = false;
    let url: string | null = null;
    let code: string | null = null;
    let buf = '';
    let backstop: ReturnType<typeof setTimeout> | undefined;

    const finish = (fn: (v: never) => void, val: unknown) => {
      if (settled) return;
      settled = true;
      if (backstop) clearTimeout(backstop);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      fn(val as never);
    };
    const onAbort = () => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish(reject, new BeamdCliError('beamd_device_aborted', 'Browser approval was cancelled.', '', null));
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    // Device codes expire (~15 min) and beamd exits on its own; backstop-kill
    // well past that so a wedged process can't hold the stream open forever.
    backstop = setTimeout(
      () => {
        try {
          child.kill();
        } catch {
          /* gone */
        }
        finish(reject, new BeamdCliError('beamd_device_expired', 'Browser approval timed out.', buf, null));
      },
      20 * 60_000,
    );

    // The challenge prints to stderr (a URL + a `XXXX-YYYY` code). Read both
    // streams and emit `pending` once we have the pair.
    const ingest = (chunk: Buffer | string) => {
      buf += String(chunk);
      if (pendingSent) return;
      if (!url) {
        const m = buf.match(/https?:\/\/[^\s'"]+/);
        if (m) url = m[0].replace(/[.,;]+$/, '');
      }
      if (!code) {
        const m = buf.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/);
        if (m) code = m[0];
      }
      if (url && code) {
        pendingSent = true;
        onPending({ verificationUri: url, verificationUriComplete: url, userCode: code, expiresIn: 0, interval: 5 });
      }
    };
    child.stdout?.on('data', ingest);
    child.stderr?.on('data', ingest);

    child.on('error', (e) => {
      finish(reject, new BeamdCliError('beamd_device_unsupported', 'Could not start browser approval.', String(e), null));
    });
    child.on('exit', (exitCode) => {
      if (settled) return;
      if (exitCode === 0) {
        finish(resolve, undefined);
        return;
      }
      // Failed before we ever showed a challenge → the edge can't do
      // device-code (OSS/static-token) or was unreachable: fall back to the
      // API-key form. Failed after → the approval expired or was denied.
      finish(
        reject,
        new BeamdCliError(
          pendingSent ? 'beamd_device_expired' : 'beamd_device_unsupported',
          pendingSent
            ? 'Browser approval didn’t complete (expired or denied). Try again.'
            : 'This edge doesn’t offer browser approval. Connect with an API key instead.',
          buf,
          exitCode ?? null,
        ),
      );
    });
  });
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

/** `check --json` landed in beamd 0.0.2 — the no-tunnel auth probe Flow relies on. */
const MIN_BEAMD_VERSION = '0.0.2';

export interface BeamdBinInfo {
  /** The beamd entry Flow resolves to (binary or shim path). */
  path: string;
  /** Where it came from — `path` = a user-installed beamd, `bundled-*` = Flow's. */
  source: BeamdBinSource;
  /** Parsed `beamd version`, or null if it couldn't be determined. */
  version: string | null;
  /** True when the version is known and below {@link MIN_BEAMD_VERSION}. */
  outdated: boolean;
  /** The floor Flow's `--json` parsing needs. */
  minVersion: string;
}

let cachedBinInfo: Promise<BeamdBinInfo> | null = null;

/**
 * Which beamd binary Flow will use, and its version. Memoized for the process —
 * surfaced by the settings/test path so version skew between Flow's beamd and
 * the machine's `~/.beamd` account is legible instead of a silent "unhealthy".
 * Deliberately off the hot path (open/close/list).
 */
export function beamdBinInfo(): Promise<BeamdBinInfo> {
  if (!cachedBinInfo) cachedBinInfo = computeBinInfo();
  return cachedBinInfo;
}

async function computeBinInfo(): Promise<BeamdBinInfo> {
  const bin = resolveBeamdBin();
  const res = await run(['version'], 5_000);
  const version = parseSemver(`${res.stdout} ${res.stderr}`);
  return {
    path: bin.binPath,
    source: bin.source,
    version,
    outdated: version != null && compareSemver(version, MIN_BEAMD_VERSION) < 0,
    minVersion: MIN_BEAMD_VERSION,
  };
}

function parseSemver(s: string): string | null {
  const m = s.match(/\d+\.\d+\.\d+/);
  return m ? m[0] : null;
}

/** Compare dotted numeric versions (`x.y.z`). Returns -1 / 0 / 1. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}
