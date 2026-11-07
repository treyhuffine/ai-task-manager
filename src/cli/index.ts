#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { getAppRoot } from '@/lib/config/paths';
import { displayRoot } from '@/lib/service/update-run';
import { serviceStatus } from '@/lib/service/client';
import { readNoticeMark, updateNotice, wantsUpdateNotice, writeNoticeMark } from '@/lib/service/update-notice';
import { applyServiceEnvironment } from '@/lib/service/environment';
import { beginActivity } from '@/lib/service/maintenance';
import { Command } from 'commander';
import { runtimeRepository } from '@/lib/releases/runtime-identity';
import { registerAcpCommand } from './commands/acp';
import { APP_NAME, APP_SHORT_ID } from '@/constants/app';
import { startCommand } from './commands/start';
import { stopCommand } from './commands/stop';
import { pairCommand } from './commands/pair';
import { doctorCommand } from './commands/doctor';
import { onboardCommand } from './commands/onboard';
import { registerVoiceCommand } from './commands/voice';
import { registerSnapshotCommand } from './commands/snapshot';
import { registerCommitCommand } from './commands/commit';
import { registerExportCommand } from './commands/export';
import { registerAgentCommand } from './commands/agent';
import { registerSkillsCommand } from './commands/skills';
import { registerTriggerCommands } from './commands/trigger';
import { registerBrowserCommands } from './commands/browser';
import { registerTlsCommand } from './commands/tls';
import { registerHomeCommand } from './commands/home';
import { registerStatusCommand } from './commands/status';
import { registerSetupCommand } from './commands/setup';
import { registerConnectCommands } from './commands/connect';
import { registerMcpCommand } from './commands/mcp';
import { registerWorkerCommand } from './commands/worker';
import { installRoleGuard } from './lib/role-guard';
import { registerUpdateCommand } from './commands/update';
import { registerServiceCommand } from './commands/service';
import { registerPerfCommand } from './commands/perf';
import { registerAttachmentCommand } from './commands/attachment';
import { registerTeamCommand, selectTeamRoot } from './commands/team';
import { spawnSync } from 'node:child_process';
import { delegationTarget, selectDefaultHome, selectExplicitRoot } from './lib/release-delegation';
import { registerHomeControlCommands } from './commands/home-control';

// Layout migration is NOT automatic — existing installs run `pnpm migrate:layout`
// (scripts/migrate-layout.ts) once to move into the home + .config + .work shape.
// Fresh installs need nothing (the ensure* helpers create dirs on demand).

/** One line, once, when an update is waiting or a Home just moved (section 7.1). */
async function sayUpdateNotice(command: string) {
  try {
    if (!wantsUpdateNotice(command, !!process.stderr.isTTY)) return;
    const update = (await serviceStatus())?.update;
    const notice = update && updateNotice(update, displayRoot(getAppRoot()), readNoticeMark());
    if (notice) { console.error(notice.line); writeNoticeMark(notice.mark); }
  } catch { /* A notice never gets in a command's way. */ }
}

function cliVersion() {
  // The package file, not the release's identity: that hashes the whole manifest,
  // and every `ri` command an agent runs passes through here.
  try { return JSON.parse(fs.readFileSync(path.join(runtimeRepository(), 'package.json'), 'utf8')).version as string; }
  catch { return 'unknown'; }
}

const program = new Command();

program
  .name(APP_SHORT_ID)
  .description(`${APP_NAME}: productivity for humans and agents`)
  .version(cliVersion());

let releaseCommand: (() => void) | undefined;
program.hook('preAction', (_program, action) => {
  if (action.name() === 'acp') return;
  if (action.name() === 'create' && action.parent?.name() === 'team') selectTeamRoot(action.opts().root);
  let top = action;
  while (top.parent && top.parent !== program) top = top.parent;
  const sub = top === action ? undefined : action.name();
  selectExplicitRoot(top.name(), top.opts().root, action.opts().root);
  // `--dev` names its Home itself.
  if (!action.opts().dev) selectDefaultHome(top.name(), sub);
  const target = delegationTarget(top.name(), sub);
  if (target) {
    const result = spawnSync(target.node, [target.cli, ...process.argv.slice(2)], { stdio: 'inherit',
      env: { ...process.env, RI_CLI_DELEGATED: '1', RI_RUNTIME_REPO: target.repo, RI_DESKTOP_REPO: target.repo, NEXT_DIST_DIR: '.next-desktop' } });
    process.exit(result.status ?? 1);
  }
  // These commands only read local inputs and call the running server. The
  // server owns persistence, including reports from a read-only reviewer.
  if (['report_result', 'report_result_review'].includes(action.name())
    || (action.name() === 'upload' && action.parent?.name() === 'attachment')) return;
  let command = action;
  while (command.parent && command.parent !== program) command = command.parent;
  if (!['service', 'update', 'start', 'stop', 'restart', 'logs'].includes(command.name())) {
    applyServiceEnvironment(process.execPath);
    releaseCommand = beginActivity();
  }
});
program.hook('postAction', async (_program, action) => {
  releaseCommand?.(); releaseCommand = undefined;
  let top = action;
  while (top.parent && top.parent !== program) top = top.parent;
  await sayUpdateNotice(top.name());
});

program
  .command('start', { isDefault: true })
  .description(`Start ${APP_NAME}, keep it running in the background, and open the app`)
  .option('--root <dir>', 'the Home\'s folder, when it isn\'t ~/ri')
  .option('--foreground', 'run in this terminal instead of the background, for debugging')
  .option('-p, --port <number>', 'port for a new Home (default: 4224, or 42241 with --dev)')
  .option('--no-open', 'do not launch the browser')
  .option('--pair', 'open the pairing URL even if already paired')
  .option('--dev', 'run the server in dev mode (next dev) instead of production')
  .option('--voice', 'start the voice sidecar (overrides saved preference)')
  .option('--no-voice', 'skip the voice sidecar (overrides saved preference)')
  .option(
    '--portless [name]',
    `front the dev server with portless.sh at <name>.localhost (default: ${APP_SHORT_ID})`,
  )
  .option('--http2', 'front the app with the built-in HTTPS/HTTP2 gateway')
  .option('--no-http2', 'use the direct HTTP startup path (overrides RI_HTTP2)')
  .option('--tls-cert <path>', 'use an existing certificate instead of generating one (requires --tls-key)')
  .option('--tls-key <path>', 'private key for --tls-cert')
  .option('--hot', 'enable the client-side hot-path tracker (sets NEXT_PUBLIC_HOT=1)')
  .action(startCommand);

program
  .command('stop')
  .description(`Stop ${APP_NAME}, and keep it stopped after restarts until \`ri start\``)
  .option('--root <dir>', 'the Home, when this computer runs several')
  .option('-p, --port <number>', 'port of the instance to stop')
  .option('--dev', 'target the dev instance (dev data root, default port 42241)')
  .option('-f, --force', 'send SIGKILL immediately instead of SIGTERM')
  .option('-t, --timeout <ms>', 'how long to wait for graceful shutdown', '5000')
  .action(stopCommand);

program
  .command('onboard')
  .description('Run first-run setup (or re-configure an existing install)')
  .option('-p, --port <number>', 'port to probe for an already-running instance', '4224')
  .option('--force', 'run the full wizard even if already onboarded')
  .action(onboardCommand);

program
  .command('pair')
  .description('Mint a new device key and print its pairing URL + QR')
  .option('-n, --name <name>', 'label for the new device (shown in web UI)')
  .option(
    '-t, --type <type>',
    'device type: desktop | laptop | phone | tablet | cli | other',
  )
  .option('--lan', 'use the LAN IP instead of the remote URL')
  .option('--local', 'use localhost instead of the remote URL')
  .option('--set-url <url>', 'save a public/tunnel base URL for off-network pairing')
  .option('--clear-url', 'forget the saved public/tunnel base URL')
  .action(pairCommand);

program
  .command('doctor')
  .description('Run diagnostic checks')
  .action(doctorCommand);

registerHomeControlCommands(program);
registerVoiceCommand(program);
registerAcpCommand(program);
registerSnapshotCommand(program);
registerCommitCommand(program);
registerExportCommand(program);
registerAgentCommand(program);
registerSkillsCommand(program);
registerTriggerCommands(program);
registerBrowserCommands(program);
registerTlsCommand(program);
registerHomeCommand(program);
registerStatusCommand(program);
registerSetupCommand(program);
registerConnectCommands(program);
registerMcpCommand(program);
registerWorkerCommand(program);
registerServiceCommand(program);
registerPerfCommand(program);
registerUpdateCommand(program);
registerAttachmentCommand(program);
registerTeamCommand(program);
installRoleGuard(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
