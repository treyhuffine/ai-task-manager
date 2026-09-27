import { Option, type Command } from 'commander';
import { serviceRequest } from '@/lib/service/client';
import type { ReleasePreferences, UpdatePreferences } from '@/lib/service/update-settings';
export function registerUpdateCommand(program: Command) {
  const update = program.command('update').description('Check, download and safely activate a signed runtime update');
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
