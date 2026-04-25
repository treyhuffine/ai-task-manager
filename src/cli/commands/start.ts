import { intro, outro, log, spinner } from '@clack/prompts';
import pc from 'picocolors';
import getPort from 'get-port';
import { APP_NAME } from '@/constants/app';
import { ensureLocalToken, setRunningPort } from '@/lib/auth/bootstrap';
import { resetDb } from '@/lib/db';
import { getVoiceEnabled } from '@/lib/config/voice';
import { APP_ROOT_ENV, getDevAppRoot } from '@/lib/config/paths';
import { startNextServer, waitForServer, isOurServerRunning } from '../lib/server';
import { openBrowser } from '../lib/browser';
import { installWorkspaceSkills } from './skills';
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

  intro(pc.bgCyan(pc.black(` ${APP_NAME} `)));

  if (opts.dev) {
    log.info(pc.dim(`Data root: ${process.env[APP_ROOT_ENV]}`));
  }

  const preferredPort = Number(opts.port ?? 4224);
  const s = spinner();

  // Auth first — used by both the health probe and the eventual app session.
  s.start('Bootstrapping auth');
  const info = ensureLocalToken();
  resetDb(); // release DB handle before spawning the server child.
  s.stop(info.created ? 'Created new host token' : 'Reusing existing token');

  // Ensure the orchestrator skill is symlinked into the app data dir so an
  // agent session opened there auto-discovers it. Idempotent: existing symlinks
  // get status='skipped' and produce no log. First install logs a single
  // success line; failures log a warning and do not block startup.
  try {
    const result = await installWorkspaceSkills();
    if (result.installed > 0) {
      log.success(`Installed ${result.installed} skill symlink(s) in the app data dir`);
    }
  } catch (err) {
    log.warn(`Skill auto-install skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Short-circuit: our server is already up on the preferred port.
  if (await isOurServerRunning(preferredPort)) {
    const url = info.pairingUrl;
    log.success(`Already running at http://localhost:${preferredPort}`);
    if (opts.open) await openBrowser(url);
    outro(opts.open ? 'Opened in browser' : `Open: ${url}`);
    return;
  }

  // Voice: start the Parakeet sidecar before Next so transcription is
  // available the moment the UI loads. Voice startup is non-fatal — if
  // Docker is down or the container fails, we warn and proceed.
  const voiceWanted = opts.voice ?? getVoiceEnabled();
  let voiceStarted = false;
  if (voiceWanted) {
    voiceStarted = await bringUpVoice(s);
  }

  const port = await getPort({ port: preferredPort });
  if (port !== preferredPort) {
    log.warn(`Port ${preferredPort} in use — using ${port}`);
  }
  process.env.PORT = String(port);
  // Persist so `pair` in another shell can reconstruct local URLs correctly.
  setRunningPort(port);

  s.start(opts.dev ? 'Starting dev server' : 'Starting server');
  const child = startNextServer({ port, dev: opts.dev });
  child.on('error', (err) => {
    log.error(`Server failed to start: ${err.message}`);
    process.exit(1);
  });
  await waitForServer(port);
  s.stop(`Server ready at http://localhost:${port}`);

  const url = info.pairingUrl;
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
    log.info('Voice already running — reusing existing container');
    return false;
  }

  if (!(await isDockerAvailable())) {
    log.warn('Voice enabled, but Docker is not running — continuing without voice');
    return false;
  }

  s.start('Starting voice sidecar (Parakeet)');
  try {
    await startVoiceService(ctx);
    await waitForVoiceReady(ctx);
    s.stop(`Voice ready at ${ctx.serviceUrl}`);
    return true;
  } catch (err) {
    s.stop(pc.yellow('Voice failed to start — continuing without voice'));
    log.warn(err instanceof Error ? err.message : String(err));
    return false;
  }
}
