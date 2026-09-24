import type { ChildProcess } from 'node:child_process';
import nodeTls from 'node:tls';
import { intro, outro, log, spinner } from '@clack/prompts';
import pc from 'picocolors';
import getPort from 'get-port';
import { APP_NAME, APP_SHORT_ID } from '@/constants/app';
import {
  ensureLocalToken,
  getLocalBaseUrl,
  getStaticUrl,
  setRunningPort,
  setStaticUrl,
  buildPairingUrl,
} from '@/lib/auth/bootstrap';
import { ensureHomeIdentity, HomeIdentityError } from '@/lib/home/identity';
import { getInstallationRole, type InstallationRole } from '@/lib/config/role';
import { runConnected } from './connected';
import { DEFAULT_PORT, DEV_PORT } from '@/lib/auth/port';
import { resolveHttp2Enabled, isChainTrustFailure, certCoversHost } from '@/lib/config/http2';
import {
  PUBLIC_BASE_URL_ENV,
  clearServerRuntimeIfOwned,
  newRunId,
  publishServerRuntime,
  readLiveServerRuntime,
} from '@/lib/server-runtime/record';
import type { Http2GatewayHandle } from '../http2-gateway/index';
import { resetDb } from '@/lib/db';
import { getVoiceEnabled } from '@/lib/config/voice';
import { getIsOnboarded, markOnboarded } from '@/lib/config/onboarded';
import { APP_ROOT_ENV, getDevAppRoot } from '@/lib/config/paths';
import {
  isPortlessInstalled,
  isOurServerRunning,
  startNextServer,
  waitForServer,
} from '../lib/server';
import { openBrowser } from '../lib/browser';
import {
  getGlobalSkillPreference,
  installAppRootSkills,
  installGlobalSkills,
} from '@/lib/agent-skills/shipped';
import { cleanupKnownProjectSkillLinks } from '@/lib/agent-skills/project-cleanup';
import { runWizard } from './onboard';
import { runDoctorChecks, printDoctorChecks } from './doctor';
import {
  getVoiceContext,
  isDockerAvailable,
  isVoiceReady,
  startVoiceService,
  stopVoiceService,
  waitForVoiceReady,
} from '../lib/voice';

export interface StartOptions {
  port?: string;
  open: boolean;
  pair: boolean;
  dev?: boolean;
  voice?: boolean;
  /** `true` when --portless is passed without a value, a string when a custom
   *  name is given, undefined when omitted. Resolved to a name + URL below. */
  portless?: boolean | string;
  /** Enables the client-side hot-path render/effect tracker. Propagated to the
   *  Next child as NEXT_PUBLIC_HOT=1 so it's inlined into the client bundle. */
  hot?: boolean;
  /** `true` from --http2, `false` from --no-http2, undefined otherwise.
   *  Resolved against RI_HTTP2 in `resolveHttp2Enabled`. */
  http2?: boolean;
  /** Supplied certificate/key pair for HTTP/2 (both required together). */
  tlsCert?: string;
  tlsKey?: string;
}

interface PortlessConfig {
  name: string;
  url: string;
}

function resolvePortless(opt: StartOptions['portless']): PortlessConfig | null {
  if (!opt) return null;
  const name = typeof opt === 'string' ? opt.trim() : APP_SHORT_ID;
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
    throw new Error(
      `Invalid --portless name '${name}'. Use letters, digits, and hyphens (no leading hyphen).`,
    );
  }
  return { name, url: `https://${name}.localhost` };
}

export async function startCommand(opts: StartOptions) {
  // Isolate dev data from prod. When --dev is passed and the user hasn't
  // already pinned a root via the standard env override, route this process
  // (and any child processes we spawn — Next, voice, CLI subcommands) to the
  // dev data root. Precedence: explicit env > --dev auto-set > prod default.
  // Set before any path helper runs so downstream callers see the dev root.
  if (opts.dev && !process.env[APP_ROOT_ENV]) {
    process.env[APP_ROOT_ENV] = getDevAppRoot();
  }

  // Propagate --hot into the Next child as NEXT_PUBLIC_HOT so the client
  // bundle gets it at build/compile time. Set before any spawn — Next reads
  // NEXT_PUBLIC_* once at startup. Console toggle (`window.__HOT__`) still
  // works as the live override either way.
  if (opts.hot) {
    process.env.NEXT_PUBLIC_HOT = '1';
  }

  intro(pc.bgCyan(pc.black(` ${APP_NAME} `)));

  if (opts.dev) {
    log.info(pc.dim(`Data root: ${process.env[APP_ROOT_ENV]}`));
  }
  if (opts.hot) {
    log.info(pc.dim('Hot-path tracker enabled (NEXT_PUBLIC_HOT=1), see src/lib/_debug/hot-path.ts'));
  }

  // What this folder is decides what `ri` does (docs/homes-spec.md §3.1). A
  // connected computer keeps no data: it opens the home, and never starts a
  // server or a database here.
  let role: InstallationRole;
  try {
    role = getInstallationRole();
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  if (role === 'connected') {
    await runConnected({ open: opts.open });
    return;
  }

  // Resolve --portless before anything that reads the static URL (auth bootstrap
  // builds pairingUrl from it). Reject early if portless isn't on PATH so the
  // user gets a clear error before we mint tokens or warm anything up.
  const portless = resolvePortless(opts.portless);
  if (portless && !isPortlessInstalled()) {
    log.error(
      `--portless requires the \`portless\` CLI on PATH. Install it from https://portless.sh and retry.`,
    );
    process.exit(1);
  }
  // Mirror the flag into persisted state so out-of-process commands (`pair`,
  // the Next route at /api/settings/base-url) reconstruct the same URL. Always
  // write — clearing when not in portless mode prevents a stale URL from
  // sticking around after a previous portless run.
  setStaticUrl(portless?.url ?? null);

  // Resolve HTTP/2 mode: explicit --http2/--no-http2 > RI_HTTP2 > disabled.
  let http2Enabled = false;
  try {
    http2Enabled = resolveHttp2Enabled(opts);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  // The built-in HTTP/2 gateway and portless are two different frontends. In
  // V1 an ambiguous combination is rejected rather than stacking TLS proxies.
  if (http2Enabled && portless) {
    log.error(
      '`--http2` and `--portless` are two different frontends. Choose one: run `--http2` for the built-in HTTPS gateway, or `--portless` for the portless.sh frontend.',
    );
    process.exit(1);
  }

  // Dev and prod default to different ports so both can run at once. An explicit
  // `-p` always wins; otherwise `--dev` picks DEV_PORT and prod picks DEFAULT_PORT.
  const preferredPort = Number(opts.port ?? (opts.dev ? DEV_PORT : DEFAULT_PORT));
  const s = spinner();

  // Auth first — used by both the health probe and the eventual app session.
  s.start('Bootstrapping auth');
  const info = ensureLocalToken();
  // A root whose data came from another computer doesn't act as the home
  // until someone claims it (docs/homes-spec.md §10.3).
  try {
    const identity = ensureHomeIdentity();
    if (identity.created) log.success(`Created your home on ${identity.computer.name}`);
  } catch (err) {
    s.stop('Not starting');
    if (err instanceof HomeIdentityError) {
      log.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  try {
    const projectSkillCleanup = await cleanupKnownProjectSkillLinks();
    if (projectSkillCleanup.removed > 0) {
      log.success(`Removed ${projectSkillCleanup.removed} legacy project skill symlink(s)`);
    }
    if (projectSkillCleanup.errors > 0) {
      log.warn(`Could not inspect ${projectSkillCleanup.errors} legacy project skill target(s)`);
    }
  } catch (err) {
    log.warn(
      `Legacy project skill cleanup skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  resetDb(); // release DB handle before spawning the server child.
  s.stop(info.created ? 'Created new host token' : 'Reusing existing token');

  // Keep the app-root skill available for sessions opened in the data home.
  // Maintain the user-level install only after the user explicitly opts in.
  // Both operations are idempotent and non-blocking for startup.
  try {
    const appRootResult = await installAppRootSkills();
    if (appRootResult.installed > 0) {
      log.success(`Installed ${appRootResult.installed} skill symlink(s) in the app data dir`);
    }
    if (getGlobalSkillPreference() === true) {
      const globalResult = await installGlobalSkills();
      if (globalResult.installed > 0) {
        log.success(`Installed ${globalResult.installed} user-level skill symlink(s)`);
      }
    }
  } catch (err) {
    log.warn(`Skill auto-install skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Resolve any live managed instance for this root first: never start a second
  // backend against a running one. If the requested mode differs, report the
  // running mode and that a switch needs a stop/start (mode changes are not
  // live in V1). This also covers HTTPS instances, which a plain HTTP health
  // fetch can't validate.
  const live = readLiveServerRuntime();
  if (live) {
    const desiredMode = http2Enabled ? 'https' : 'http';
    if (live.mode !== desiredMode) {
      log.warn(
        `Already running at ${live.publicBaseUrl} in ${live.mode.toUpperCase()} mode. ` +
          `Switching to ${desiredMode.toUpperCase()} needs a restart: run \`${APP_SHORT_ID} stop\`, then start again.`,
      );
      outro('Left the running instance unchanged');
      return;
    }
    const url = buildPairingUrl(info.plaintext, live.publicBaseUrl);
    log.success(`Already running at ${live.publicBaseUrl}`);
    if (opts.open) await openBrowser(url);
    outro(opts.open ? 'Opened in browser' : `Open: ${url}`);
    return;
  }

  // Short-circuit: our server is already up. Probe the public URL — under
  // portless that's `https://<name>.localhost` (staticUrl); otherwise probe the
  // exact port we're about to bind. Using `preferredPort` (not the remembered
  // lastPort) avoids a false-positive on a *different* instance — e.g. a dev
  // start on 42241 must not mistake a prod server on 4224 for "already running".
  const probeUrl = getStaticUrl() ?? `http://localhost:${preferredPort}`;
  if (await isOurServerRunning(probeUrl)) {
    // Build the pairing URL against the URL we just confirmed is live, not the
    // token's baked-in default (which predates port binding).
    const url = buildPairingUrl(info.plaintext, probeUrl);
    log.success(`Already running at ${probeUrl}`);
    if (opts.open) await openBrowser(url);
    outro(opts.open ? 'Opened in browser' : `Open: ${url}`);
    return;
  }

  // First-run setup. Walk the CLI wizard if this brain has never been
  // onboarded and we're attached to a real terminal. Headless invocations
  // (smoke tests, CI, scripted starts) skip silently — `ri onboard` is
  // available later if they want to configure interactively.
  if (!getIsOnboarded()) {
    if (process.stdin.isTTY) {
      await runWizard();
      markOnboarded();
      log.success('Setup complete');
    } else {
      log.info('Skipping CLI setup (non-interactive). Run `ri onboard` to configure.');
    }
  }

  // Diagnostics preflight — surface misconfiguration before we start anything
  // that depends on it (voice, server). Non-blocking: warnings are informational.
  const diagnostics = await runDoctorChecks();
  printDoctorChecks(diagnostics, { compact: true });

  // Voice: start the Parakeet sidecar before Next so transcription is
  // available the moment the UI loads. Voice startup is non-fatal — if
  // Docker is down or the container fails, we warn and proceed.
  const voiceWanted = opts.voice ?? getVoiceEnabled();
  let voiceStarted = false;
  if (voiceWanted) {
    voiceStarted = await bringUpVoice(s);
  }

  // Dev cold-boots are slow and unbounded-ish: Turbopack compiles the whole app
  // on first run (the "Ready in Xs" line alone can be 35s+), and Next compiles
  // routes lazily, so the first /api/health hit lands well after "Ready". Give
  // dev a generous ceiling. Portless adds proxy startup on top of either mode.
  const readyTimeoutMs = opts.dev ? 120_000 : portless ? 120_000 : 90_000;

  const runId = newRunId();
  let child: ChildProcess;
  let gateway: Http2GatewayHandle | null = null;
  let mode: 'http' | 'https' = 'http';
  let publicBaseUrl: string;
  let publicPort = 0;
  let privateNextUrl: string;

  if (http2Enabled) {
    mode = 'https';
    // Resolve TLS material: a supplied pair (--tls-cert/--tls-key) or the
    // generated local CA/leaf. Generation changes no system trust — that is the
    // separate, explicit `tls trust` step.
    let tls;
    try {
      const tlsMod = await import('@/lib/config/tls');
      tls = await tlsMod.resolveTlsMaterial({ certPath: opts.tlsCert, keyPath: opts.tlsKey });
    } catch (err) {
      log.error(`TLS configuration error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    if (tls.source === 'generated') {
      log.info(
        pc.dim(
          `Using a generated local certificate (leaf valid until ${tls.notAfter
            .toISOString()
            .slice(0, 10)}). If your browser does not trust it yet, run \`${APP_SHORT_ID} tls trust\`.`,
        ),
      );
    }

    // Distinct public (browser-facing) and private (Next) ports. Next binds
    // loopback-only; the launcher reports the public HTTPS origin via the env
    // override rather than PORT, which Next overwrites with its private port.
    publicPort = await getPort({ port: preferredPort });
    if (publicPort !== preferredPort) log.warn(`Port ${preferredPort} in use, using ${publicPort}`);
    const privatePort = await getPort();
    publicBaseUrl = `https://localhost:${publicPort}`;
    privateNextUrl = `http://127.0.0.1:${privatePort}`;

    // Validate a supplied certificate covers the public host up front and
    // independently of the readiness probe — an untrusted-issuer error can mask
    // a hostname mismatch in the TLS handshake, so check it here where the
    // browser's own rejection is predictable.
    if (tls.source === 'supplied') {
      const host = new URL(publicBaseUrl).hostname;
      if (!certCoversHost(tls.cert, host)) {
        // Nothing has been spawned yet — fail fast before starting Next/gateway.
        log.error(
          `Supplied --tls-cert does not cover the public host "${host}". ` +
            `The browser would reject it. Provide a certificate valid for ${host}.`,
        );
        process.exit(1);
      }
    }

    process.env[PUBLIC_BASE_URL_ENV] = publicBaseUrl;
    setRunningPort(publicPort);

    s.start('Starting server (HTTP/2)');
    child = startNextServer({ port: privatePort, dev: opts.dev, hostname: '127.0.0.1' });
    child.on('error', (err) => {
      log.error(`Server failed to start: ${err.message}`);
      process.exit(1);
    });
    await waitForServer(privateNextUrl, readyTimeoutMs);

    const { startHttp2Gateway } = await import('../http2-gateway/index');
    try {
      gateway = await startHttp2Gateway({
        publicPort,
        publicBaseUrl,
        upstreamHost: '127.0.0.1',
        upstreamPort: privatePort,
        tls,
        onLog: (m) => log.message(pc.dim(m)),
      });
    } catch (err) {
      log.error(`HTTP/2 gateway failed to start: ${err instanceof Error ? err.message : String(err)}`);
      if (!child.killed) child.kill('SIGTERM');
      process.exit(1);
    }

    // Readiness requires a real h2 negotiation through the public listener, not
    // just a reachable HTTPS URL. A generated CA must always validate, so a
    // failed probe is fatal. A supplied certificate may chain to an authority
    // this local probe cannot see (e.g. an mkcert CA in the OS store), so trust
    // the supplied bundle plus the system roots and, if it still cannot be
    // validated locally, warn and proceed — the user vouched for it and the
    // browser may trust it. Validation is never globally disabled.
    const probeCa =
      tls.source === 'supplied' ? [tls.probeCa, ...nodeTls.rootCertificates] : tls.probeCa;
    const probe = await gateway.probe(probeCa);
    if (!probe.ok) {
      // Only a supplied cert whose failure is specifically an untrusted chain is
      // allowed to proceed (the browser may trust a CA our probe cannot see).
      // A generated cert, a failed health check, an h2 negotiation failure, or a
      // connection error is always fatal — never bypass those.
      const trustChainIssue = tls.source === 'supplied' && isChainTrustFailure(probe.detail);
      if (!trustChainIssue) {
        log.error(
          `HTTP/2 readiness probe failed (protocol=${probe.negotiatedProtocol ?? 'none'}, ` +
            `status=${probe.status ?? 'n/a'}${probe.detail ? `, ${probe.detail}` : ''}). ` +
            `Retry, or start with \`--no-http2\`.`,
        );
        await gateway.close(2000).catch(() => {});
        if (!child.killed) child.kill('SIGTERM');
        process.exit(1);
      }
      log.warn(
        `Could not validate the supplied certificate's chain locally (${probe.detail}). ` +
          `Proceeding since you supplied it explicitly. Make sure your browser trusts it.`,
      );
      s.stop(`Server ready at ${publicBaseUrl}`);
    } else {
      s.stop(`Server ready at ${publicBaseUrl} (negotiated ${probe.negotiatedProtocol})`);
    }
  } else {
    // Existing direct-HTTP path (including portless). Under portless the proxy
    // picks a random port and injects $PORT to the child; we pass 0 as an unused
    // sentinel and never persist a port for it.
    let port = 0;
    if (!portless) {
      port = await getPort({ port: preferredPort });
      if (port !== preferredPort) log.warn(`Port ${preferredPort} in use, using ${port}`);
      process.env.PORT = String(port);
      setRunningPort(port);
    }
    s.start(
      portless
        ? `Starting dev server via portless (${portless.url})`
        : opts.dev
          ? 'Starting dev server'
          : 'Starting server',
    );
    child = startNextServer({ port, dev: opts.dev, portlessName: portless?.name });
    child.on('error', (err) => {
      log.error(`Server failed to start: ${err.message}`);
      process.exit(1);
    });
    await waitForServer(getLocalBaseUrl(), readyTimeoutMs);
    s.stop(`Server ready at ${getLocalBaseUrl()}`);
    publicBaseUrl = getLocalBaseUrl();
    publicPort = port;
    privateNextUrl = portless ? publicBaseUrl : `http://localhost:${port}`;
  }

  // Publish the discovery/ownership record after readiness so `stop`, `pair`,
  // and URL helpers can find this instance. Skip portless: the launcher does
  // not own the portless-assigned port, and legacy staticUrl already covers it.
  if (!portless) {
    publishServerRuntime({
      version: 1,
      runId,
      launcherPid: process.pid,
      startedAt: new Date().toISOString(),
      mode,
      http2: http2Enabled,
      publicBaseUrl,
      publicPort,
      privateUpstreams: { next: privateNextUrl },
    });
  }

  const url = buildPairingUrl(info.plaintext);
  if (opts.open) {
    await openBrowser(url);
    log.success(`Opened ${url}`);
  } else {
    log.info(`Open: ${url}`);
  }

  outro('Press Ctrl-C to stop');

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Clear our discovery record first (only if it is still ours), then drain
    // the gateway, then Next, then voice.
    if (!portless) clearServerRuntimeIfOwned(runId);
    if (gateway) await gateway.close(5000).catch(() => {});
    if (!child.killed) child.kill(signal);
    if (voiceStarted) {
      await stopVoiceService().catch(() => {});
    }
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Stay alive until the server child exits.
  await new Promise<void>((resolve) => {
    child.on('exit', () => resolve());
  });
  // Child exited on its own (crash or external kill): tidy up owned state.
  if (!portless) clearServerRuntimeIfOwned(runId);
  if (gateway) await gateway.close(3000).catch(() => {});
}

/**
 * Bring up the voice sidecar. Returns true if the container is ours to stop
 * on shutdown; false if it was already running (don't touch it) or unavailable.
 */
async function bringUpVoice(s: ReturnType<typeof spinner>): Promise<boolean> {
  const ctx = getVoiceContext();

  // Already warm — reuse it. Don't claim ownership, leave it as we found it.
  if (await isVoiceReady(ctx)) {
    log.info('Voice already running, reusing existing container');
    return false;
  }

  if (!(await isDockerAvailable())) {
    log.warn('Voice enabled, but Docker is not running, continuing without voice');
    return false;
  }

  s.start('Starting voice sidecar (Parakeet)');
  try {
    await startVoiceService(ctx);
    await waitForVoiceReady(ctx);
    s.stop(`Voice ready at ${ctx.serviceUrl}`);
    return true;
  } catch (err) {
    s.stop(pc.yellow('Voice failed to start, continuing without voice'));
    log.warn(err instanceof Error ? err.message : String(err));
    return false;
  }
}
