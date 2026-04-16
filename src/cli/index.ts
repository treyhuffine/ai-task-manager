#!/usr/bin/env node
import { Command } from 'commander';
import { APP_NAME, APP_SHORT_ID } from '@/constants/app';
import { startCommand } from './commands/start';
import { pairCommand } from './commands/pair';
import { doctorCommand } from './commands/doctor';
import { onboardCommand } from './commands/onboard';
import { registerVoiceCommand } from './commands/voice';
import { registerExportCommand } from './commands/export';

const program = new Command();

program
  .name(APP_SHORT_ID)
  .description(`${APP_NAME} — productivity for humans and agents`)
  .version('0.0.1');

program
  .command('start', { isDefault: true })
  .description(`Start ${APP_NAME} and open the app`)
  .option('-p, --port <number>', 'port to bind', '4224')
  .option('--no-open', 'do not launch the browser')
  .option('--pair', 'open the pairing URL even if already paired')
  .option('--dev', 'run the server in dev mode (next dev) instead of production')
  .option('--voice', 'start the voice sidecar (overrides saved preference)')
  .option('--no-voice', 'skip the voice sidecar (overrides saved preference)')
  .action(startCommand);

program
  .command('onboard')
  .description('Run first-run setup (or re-configure an existing install)')
  .option('-p, --port <number>', 'port to probe for an already-running instance', '4224')
  .option('--force', 'run the full wizard even if already onboarded')
  .action(onboardCommand);

program
  .command('pair')
  .description('Print the pairing URL (creates a token if missing)')
  .action(pairCommand);

program
  .command('doctor')
  .description('Run diagnostic checks')
  .action(doctorCommand);

registerVoiceCommand(program);
registerExportCommand(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
