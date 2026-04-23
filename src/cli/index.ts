#!/usr/bin/env node
import { Command } from 'commander';
import { APP_NAME, APP_SHORT_ID } from '@/constants/app';
import { migrateLegacyLayoutToBrain } from '@/lib/config/paths';
import { startCommand } from './commands/start';
import { pairCommand } from './commands/pair';
import { doctorCommand } from './commands/doctor';
import { onboardCommand } from './commands/onboard';
import { registerVoiceCommand } from './commands/voice';
import { registerSnapshotCommand } from './commands/snapshot';
import { registerCommitCommand } from './commands/commit';
import { registerExportCommand } from './commands/export';

// One-shot migration: if we find the pre-brain/ flat layout, move it into
// brain/ before any command opens the db or reads from the old paths.
const migration = migrateLegacyLayoutToBrain();
if (migration.migrated) {
  console.log(`[paths] migrated legacy layout → brain/ (${migration.moved.join(', ')})`);
}

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

registerVoiceCommand(program);
registerSnapshotCommand(program);
registerCommitCommand(program);
registerExportCommand(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
