import fs from 'node:fs';
import readline from 'node:readline/promises';
import { Option, type Command } from 'commander';
import { serviceRequest, serviceStatus } from '@/lib/service/client';
import type { ReleasePreferences, UpdatePreferences } from '@/lib/service/update-settings';
import { listHomes } from '@/lib/service/store';
import { parseFrom, readOrigin, writeOrigin, type Origin } from '@/lib/service/origin';
import { buildRelease, selectCommit } from '@/lib/service/source-build';
import { commandLauncherPath, installCommandLauncher } from '@/lib/service/runtime';
import { commandCheck, resolveCommand } from '@/lib/service/os-checks';
import { defaultHome, homeAtRoot } from '@/lib/service/home-lookup';
import { describeRollback, displayRoot, runUpdate, withHomeIdentity, type HomeClient, type HomeStatus } from '@/lib/service/update-run';
import type { RollbackStatus } from '@/lib/service/update';

interface UpdateOptions { now?: boolean; rollback?: boolean; yes?: boolean; root?: string; from?: string; channel?: 'stable' | 'latest'; auto?: 'on' | 'off' }

function client(identity: Parameters<typeof withHomeIdentity>[0]): HomeClient {
  return {
    status: () => withHomeIdentity(identity, () => serviceStatus()) as Promise<HomeStatus | null>,
    request: (route, method, timeoutMs, body) => withHomeIdentity(identity, () => serviceRequest(route, method, timeoutMs, body)),
  };
}

function describeOrigin(origin: Origin) {
  const source = origin.source === 'checkout' ? `built from ${displayRoot(origin.checkout!)} when you run \`ri update\`` : `published releases on the ${origin.channel} channel`;
  return `This computer gets Ri from ${source}. Automatic updates are ${origin.auto ? 'on' : 'off'}${origin.source === 'checkout' ? ' (they apply to published releases only)' : ''}.`;
}

async function rollback(options: UpdateOptions) {
  const home = options.root ? homeAtRoot(options.root) : defaultHome();
  if (!home) throw new Error(options.root ? `This computer doesn't run a Home in ${options.root}.` : 'No Home on this computer has moved to the installation yet. To name one: --root <folder>');
  const homeClient = client(home.identity);
  if (!(await homeClient.status())) throw new Error(`${displayRoot(home.identity.root)} isn't running. Start it with \`ri start\`, then roll back.`);
  const { rollback: state } = await homeClient.request<{ rollback: RollbackStatus }>('/update/rollback');
  console.info(describeRollback(home.identity.root, state));
  if (!state.available) { process.exitCode = 1; return; }
  if (!options.yes) {
    if (!process.stdin.isTTY) throw new Error('Run it again with --yes to roll back without being asked.');
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt.question('Roll back? [y/N] ');
    prompt.close();
    if (!/^y(es)?$/i.test(answer.trim())) { console.info('Nothing was changed.'); return; }
  }
  const before = await homeClient.status();
  await homeClient.request('/update', 'POST', 3000, { action: 'rollback' });
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    let status: HomeStatus | null = null;
    try { status = await homeClient.status(); } catch { /* mid-handover */ }
    if (status && status.runId !== before?.runId && status.phase === 'running') { console.info(`${displayRoot(home.identity.root)} rolled back.`); return; }
    if (status?.update?.error && status.runId === before?.runId && status.update.phase !== 'committed') { throw new Error(status.update.error); }
  }
  console.info('Still rolling back. Check with `ri status`.');
}

export function registerUpdateCommand(program: Command) {
  const update = program.command('update').description('Update Ri on this computer, then switch every Home to the new version')
    .option('--now', 'switch without waiting for running chats, which ends them')
    .option('--rollback', 'go back one release on a Home, after showing what that would lose')
    .option('--yes', 'roll back without asking')
    .option('--root <dir>', 'the Home to roll back, when this computer runs several')
    .option('--from <folder>', 'build releases from this checkout of Ri, or "published" to go back to published releases')
    .addOption(new Option('--channel <channel>', 'which published releases to get').choices(['stable', 'latest']))
    .addOption(new Option('--auto <mode>', 'automatic updates for published releases').choices(['on', 'off']))
    .action(async (options: UpdateOptions) => {
      const change: Partial<Omit<Origin, 'version'>> = {};
      if (options.channel) change.channel = options.channel;
      if (options.auto) change.auto = options.auto === 'on';
      if (options.from) Object.assign(change, parseFrom(options.from));
      if (Object.keys(change).length) console.info(describeOrigin(writeOrigin(change)));
      // Changing a setting alone doesn't start an update.
      if ((options.channel || options.auto) && !options.from && !options.now) return;
      if (options.rollback) return rollback(options);
      const outcomes = await runUpdate({ now: options.now }, {
        homes: listHomes, client, origin: readOrigin, select: selectCommit, build: buildRelease, launcher: installCommandLauncher,
        say: line => console.info(line), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), now: Date.now,
      });
      if (outcomes.some(outcome => outcome.result === 'failed' || outcome.result === 'reverted')) process.exitCode = 1;
      // An installed launcher does nothing if another `ri` comes first.
      const launcherPath = commandLauncherPath();
      const command = commandCheck(resolveCommand('ri'), launcherPath, fs.existsSync(launcherPath));
      if (command.warn) console.info(`The ri command: ${command.detail}`);
    });
  update.command('recover').description('Retry the recorded recovery after correcting its reported problem. Then start the service again.').action(async () => {
    console.info(JSON.stringify(await serviceRequest('/recover', 'POST', 180_000), null, 2));
    console.info('Recovery completed. Run ri service start to reconnect.');
  });
  update.command('status').action(async () => { console.info(JSON.stringify(await serviceRequest('/update'), null, 2)); });
  update.command('preferences').description('Show or change automatic download preferences without changing the publisher')
    .addOption(new Option('--automatic-download <mode>', 'download verified updates after periodic checks').choices(['on', 'off']))
    .addOption(new Option('--metered <mode>', 'pause automatic downloads while enabled').choices(['on', 'off']))
    .action(async (options: { automaticDownload?: 'on' | 'off'; metered?: 'on' | 'off' }) => {
      const preferences: UpdatePreferences = {
        ...(options.automaticDownload === undefined ? {} : { automaticDownload: options.automaticDownload === 'on' }),
        ...(options.metered === undefined ? {} : { metered: options.metered === 'on' }),
      };
      if (Object.keys(preferences).length) {
        const response = await serviceRequest<{ policy: ReleasePreferences }>('/update/policy', 'PATCH', 3000, preferences);
        console.info(JSON.stringify(response.policy, null, 2));
      } else {
        const response = await serviceRequest<{ update: { policy: ReleasePreferences | null } }>('/update');
        console.info(JSON.stringify(response.update.policy ?? { configured: false }, null, 2));
      }
    });
  for (const action of ['check', 'download', 'apply', 'when-idle', 'later'] as const) {
    const command = update.command(action).description({ check: 'Check the configured publisher feed', download: 'Download and verify the available runtime', apply: 'Approve activation at the next safe point', 'when-idle': 'Remember approval and wait for work to finish', later: 'Cancel pending activation and keep the download' }[action]);
    if (action === 'when-idle') command.option('--hour <hour>', 'maintenance window start, 0-23').option('--hours <hours>', 'window duration, 1-12', '2').option('--timezone <name>', 'IANA timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
    command.action(async (options: { hour?: string; hours?: string; timezone?: string }) => {
      const window = options.hour === undefined ? undefined : { hour: Number(options.hour), durationHours: Number(options.hours), timeZone: options.timezone };
      console.info(JSON.stringify(await serviceRequest('/update', 'POST', 3000, { action, window }), null, 2));
    });
  }
}
