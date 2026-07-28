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
import { DEFAULT_PORT, DEV_PORT } from '@/lib/auth/port';
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

  // Dev and prod default to different ports so both can run at once. An explicit
  // `-p` always wins; otherwise `--dev` picks DEV_PORT and prod picks DEFAULT_PORT.
  const preferredPort = Number(opts.port ?? (opts.dev ? DEV_PORT : DEFAULT_PORT));
  const s = spinner();

  // Auth first — used by both the health probe and the eventual app session.
  s.start('Bootstrapping auth');
  const info = ensureLocalToken();
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
  // (smoke tests, CI, scripted starts) skip silently — `flow onboard` is
  // available later if they want to configure interactively.
  if (!getIsOnboarded()) {
    if (process.stdin.isTTY) {
      await runWizard();
      markOnboarded();
      log.success('Setup complete');
    } else {
      log.info('Skipping CLI setup (non-interactive). Run `flow onboard` to configure.');
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

  // Port allocation: only when we own the binding. Under portless, the proxy
  // picks a random port (4000-4999) and injects $PORT to the child Next, so
  // we'd be allocating something we never use — and persisting the wrong port
  // would confuse out-of-process commands like `pair`. Pass 0 as a sentinel
  // (unused by startNextServer in that branch).
  let port = 0;
  if (!portless) {
    port = await getPort({ port: preferredPort });
    if (port !== preferredPort) {
      log.warn(`Port ${preferredPort} in use, using ${port}`);
    }
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
  const child = startNextServer({
    port,
    dev: opts.dev,
    portlessName: portless?.name,
  });
  child.on('error', (err) => {
    log.error(`Server failed to start: ${err.message}`);
    process.exit(1);
  });
  // Wait against the public URL — under portless the proxy needs its backend
  // up before /api/health succeeds; without portless this is just localhost.
  //
  // Dev cold-boots are slow and unbounded-ish: Turbopack compiles the whole app
  // on first run (the "Ready in Xs" line alone can be 35s+), and Next compiles
  // routes lazily, so the first /api/health hit lands well after "Ready". A tight
  // ceiling here makes the CLI report a timeout and exit 1 while the spawned Next
  // child keeps booting in the background and eventually works — confusing. Give
  // dev a generous ceiling. Portless adds proxy startup on top of either mode.
  const readyTimeoutMs = opts.dev ? 120_000 : portless ? 120_000 : 90_000;
  await waitForServer(getLocalBaseUrl(), readyTimeoutMs);
  s.stop(`Server ready at ${getLocalBaseUrl()}`);

  // Rebuild against the now-bound port. `info.pairingUrl` was computed in
  // `ensureLocalToken()` before `process.env.PORT` was set, so it carries the
  // default port (e.g. 4224) even when the dev server bound 42241.
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
    // Tear down in reverse order of startup: Next first, then voice.
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
