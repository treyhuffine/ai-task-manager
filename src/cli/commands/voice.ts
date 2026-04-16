/**
 * `<app> voice [subcommand]`
 *
 * The surface the web UI points users to when voice isn't working:
 *
 *   <app> voice            → show status (Docker, container, health, preference)
 *   <app> voice start      → bring up the Parakeet sidecar
 *   <app> voice stop       → stop the sidecar (preserves the model volume)
 *   <app> voice restart    → stop + start
 *   <app> voice enable     → set the saved preference to on
 *   <app> voice disable    → set the saved preference to off
 *   <app> voice logs       → tail container logs (useful for debugging)
 */

import { Command } from 'commander';
import { spawn } from 'node:child_process';
import pc from 'picocolors';
import {
  getVoiceContext,
  isDockerAvailable,
  isVoiceReady,
  startVoiceService,
  stopVoiceService,
  waitForVoiceReady,
} from '../lib/voice';
import { getVoiceEnabled, setVoiceEnabled } from '@/lib/config/voice';

export function registerVoiceCommand(program: Command) {
  const voice = program
    .command('voice')
    .description('Manage the voice (speech-to-text) sidecar');

  voice
    .command('status', { isDefault: true })
    .description('Show voice service status')
    .action(statusAction);

  voice
    .command('start')
    .description('Start the voice sidecar')
    .action(startAction);

  voice
    .command('stop')
    .description('Stop the voice sidecar (keeps model cache)')
    .action(stopAction);

  voice
    .command('restart')
    .description('Restart the voice sidecar')
    .action(async () => {
      await stopAction();
      await startAction();
    });

  voice
    .command('enable')
    .description('Remember to auto-start voice with the server')
    .action(() => {
      setVoiceEnabled(true);
      console.log(pc.green('Voice enabled.'));
      console.log(pc.dim('Run `voice start` now, or it will come up on next server start.'));
    });

  voice
    .command('disable')
    .description('Stop auto-starting voice with the server')
    .action(() => {
      setVoiceEnabled(false);
      console.log(pc.yellow('Voice disabled.'));
      console.log(pc.dim('The sidecar won\'t start automatically. Run `voice stop` if it\'s currently running.'));
    });

  voice
    .command('logs')
    .description('Tail voice sidecar logs (Ctrl-C to exit)')
    .action(logsAction);
}

async function statusAction() {
  const ctx = getVoiceContext();
  const [dockerOk, voiceOk] = await Promise.all([isDockerAvailable(), isVoiceReady(ctx)]);
  const pref = getVoiceEnabled();

  console.log();
  row('Preference', pref ? pc.green('enabled') : pc.dim('disabled'));
  row('Docker daemon', dockerOk ? pc.green('running') : pc.red('not running'));
  row('Voice service', voiceOk ? pc.green(`ready (${ctx.serviceUrl})`) : pc.yellow('not responding'));
  console.log();

  // Helpful next step based on state.
  if (!pref && !voiceOk) {
    console.log(pc.dim('→ `voice enable` to turn on, then `voice start`.'));
  } else if (pref && !dockerOk) {
    console.log(pc.dim('→ Start Docker, then `voice start`.'));
  } else if (pref && dockerOk && !voiceOk) {
    console.log(pc.dim('→ `voice start` to bring up the sidecar.'));
  } else if (voiceOk) {
    console.log(pc.dim('→ Everything looks good.'));
  }
}

async function startAction() {
  const ctx = getVoiceContext();

  if (await isVoiceReady(ctx)) {
    console.log(pc.green(`Voice is already running at ${ctx.serviceUrl}`));
    return;
  }

  if (!(await isDockerAvailable())) {
    console.error(pc.red('Docker is not running.'));
    console.error(pc.dim('Start Docker Desktop (or your Docker daemon) and re-run this command.'));
    process.exit(1);
  }

  console.log('Starting voice sidecar (this can take several minutes on the first run)…');
  try {
    await startVoiceService(ctx);
    await waitForVoiceReady(ctx);
    console.log(pc.green(`Voice ready at ${ctx.serviceUrl}`));
  } catch (err) {
    console.error(pc.red('Voice failed to start.'));
    console.error(err instanceof Error ? err.message : String(err));
    console.error(pc.dim('Run `voice logs` to inspect container output.'));
    process.exit(1);
  }
}

async function stopAction() {
  const ctx = getVoiceContext();
  if (!(await isDockerAvailable())) {
    console.log(pc.dim('Docker is not running — nothing to stop.'));
    return;
  }
  await stopVoiceService(ctx);
  console.log(pc.green('Voice stopped.'));
}

function logsAction(): Promise<void> {
  const ctx = getVoiceContext();
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['compose', '-f', ctx.composeFile, 'logs', '-f', ctx.service],
      { stdio: 'inherit' },
    );
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`logs exited with code ${code}`))));
    child.on('error', reject);
  });
}

function row(label: string, value: string) {
  console.log(`  ${label.padEnd(15)} ${value}`);
}
