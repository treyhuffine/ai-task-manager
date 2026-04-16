/**
 * First-run (and re-run) setup wizard.
 *
 * Branches on state:
 *   - Fresh install   → run wizard → mark onboarded → optionally start server
 *   - Already onboarded
 *     - Server running → offer: open in browser / update config / cancel
 *     - Server stopped → offer: update config / start server / cancel
 *
 * The actual config prompts are stubs today — they'll grow as API-key prompts,
 * workspace seeding, etc. get added. Everything shared with `start` flows
 * through the same helpers so both commands stay in lockstep.
 */

import { intro, outro, log, confirm, select, isCancel, spinner } from '@clack/prompts';
import pc from 'picocolors';
import { APP_NAME } from '@/constants/app';
import { ensureLocalToken } from '@/lib/auth/bootstrap';
import { resetDb } from '@/lib/db';
import { getIsOnboarded, markOnboarded, getOnboardedAt } from '@/lib/config/onboarded';
import { getVoiceEnabled, setVoiceEnabled } from '@/lib/config/voice';
import { isOurServerRunning } from '../lib/server';
import { isDockerAvailable } from '../lib/voice';
import { openBrowser } from '../lib/browser';
import { startCommand } from './start';

export interface OnboardOptions {
  force?: boolean;
  port?: string;
}

export async function onboardCommand(opts: OnboardOptions) {
  intro(pc.bgCyan(pc.black(` ${APP_NAME} onboard `)));

  const port = Number(opts.port ?? 4224);

  // Always ensure a token exists so we can probe /api/health below.
  const s = spinner();
  s.start('Bootstrapping auth');
  const info = ensureLocalToken();
  resetDb();
  s.stop(info.created ? 'Created new host token' : 'Reusing existing token');

  const serverRunning = await isOurServerRunning(port, info.plaintext);
  const alreadyOnboarded = getIsOnboarded();

  // ─── Branch 1: fresh install ────────────────────────────────────────
  if (!alreadyOnboarded || opts.force) {
    if (opts.force && alreadyOnboarded) {
      log.info('Re-running setup (--force)');
    }
    await runWizard();
    markOnboarded();
    log.success('Setup complete');

    const startNow = await confirm({
      message: serverRunning ? 'Server is already running. Open it now?' : 'Start the server now?',
      initialValue: true,
    });
    if (isCancel(startNow) || !startNow) {
      outro('All set — run the default command anytime to start.');
      return;
    }

    if (serverRunning) {
      await openBrowser(info.pairingUrl);
      outro(`Opened http://localhost:${port}`);
      return;
    }

    outro('Starting server…');
    await startCommand({ port: String(port), open: true, pair: false });
    return;
  }

  // ─── Branch 2: already onboarded ────────────────────────────────────
  const at = getOnboardedAt();
  const whenLine = at ? pc.dim(`(onboarded ${at.toLocaleDateString()})`) : '';
  log.info(`You're already set up ${whenLine}`);

  type Action = 'open' | 'start' | 'update' | 'cancel';
  const options: Array<{ value: Action; label: string; hint?: string }> = [];

  if (serverRunning) {
    options.push({ value: 'open', label: 'Open in browser', hint: `http://localhost:${port}` });
  } else {
    options.push({ value: 'start', label: 'Start the server' });
  }
  options.push({ value: 'update', label: 'Update configuration' });
  options.push({ value: 'cancel', label: 'Cancel' });

  const action = (await select({
    message: 'What would you like to do?',
    options,
  })) as Action | symbol;

  if (isCancel(action) || action === 'cancel') {
    outro('No changes.');
    return;
  }

  if (action === 'open') {
    await openBrowser(info.pairingUrl);
    outro(`Opened http://localhost:${port}`);
    return;
  }

  if (action === 'start') {
    outro('Starting server…');
    await startCommand({ port: String(port), open: true, pair: false });
    return;
  }

  if (action === 'update') {
    await runWizard();
    markOnboarded(); // refresh the timestamp
    log.success('Configuration updated');

    const followUp = await confirm({
      message: serverRunning
        ? 'Server is running with the previous config. Open it?'
        : 'Start the server now?',
      initialValue: true,
    });
    if (isCancel(followUp) || !followUp) {
      outro('Done.');
      return;
    }

    if (serverRunning) {
      await openBrowser(info.pairingUrl);
      outro(`Opened http://localhost:${port}`);
      return;
    }

    outro('Starting server…');
    await startCommand({ port: String(port), open: true, pair: false });
  }
}

/**
 * The actual setup questions.
 *
 * Today: only the voice/Docker prompt is real — API-key prompts will land
 * here next. Keep wizard steps in one function so `start`'s auto-onboard and
 * the explicit `onboard` command share identical behavior.
 */
async function runWizard(): Promise<void> {
  // Voice prompt. Default YES if Docker is reachable, NO if it isn't —
  // but always ask, so the user can intentionally opt out.
  const dockerOk = await isDockerAvailable();
  const currentPref = getVoiceEnabled();

  const voiceMsg = dockerOk
    ? 'Enable voice (local speech-to-text via Docker/Parakeet)?'
    : 'Enable voice? Docker is not running — voice will stay off until you start it.';

  const voice = await confirm({
    message: voiceMsg,
    initialValue: dockerOk ? currentPref || currentPref === null : false,
  });
  if (isCancel(voice)) {
    throw new Error('Setup cancelled');
  }
  setVoiceEnabled(!!voice);

  if (voice && !dockerOk) {
    log.info('Voice is enabled — start Docker before running the server to activate it.');
  }

  // TODO: prompt for ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
  // TODO: seed starter workspace
}
