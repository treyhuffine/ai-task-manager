import fs from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { APP_ROOT_ENV, resolveDevAppRoot } from '@/lib/config/paths';
import { ensureServiceStatus, serviceRequest, serviceStatus, stopService } from '@/lib/service/client';
import { readAwakePreferences } from '@/lib/service/awake';
import { servicePaths } from '@/lib/service/paths';
import { createRuntimeManifest, installedRuntime, stageRuntime, verifyRuntime } from '@/lib/service/runtime';
import { beginActivity } from '@/lib/service/maintenance';
import { saveEnvironment, environmentStatus } from '@/lib/service/environment';
import { installService, uninstallService } from '@/lib/service/install';
import { allowMigrations } from '@/lib/db/migrate';

export function registerServiceCommand(program: Command) {
  const service = program.command('service').description('Manage the local background backend shared by desktop and CLI')
    .option('--root <directory>', 'explicit data root');
  service.hook('preAction', command => {
    const root = command.opts().root as string | undefined;
    if (root) process.env[APP_ROOT_ENV] = path.resolve(root);
  });
  service.command('start').description('Start or attach without keeping this terminal open')
    .option('--dev', 'use the development server')
    .option('--home', 'choose this new installation as a Home before starting')
    .action(async (options: { dev?: boolean; home?: boolean }) => {
      // Resolve the identity before runtime lookup or service discovery, just
      // as the foreground `start --dev` command does.
      if (options.dev) process.env[APP_ROOT_ENV] = resolveDevAppRoot();
      // Starting is when a home's database may change (src/lib/db/migrate.ts).
      allowMigrations();
      if (options.home && (await import('@/lib/service/role')).resolveServiceRole().role !== 'home') {
        (await import('@/lib/service/desktop-role-intent')).writeDesktopHomeIntent();
      }
      const installed = installedRuntime();
      const repo = installed?.repo ?? process.env.RI_RUNTIME_REPO ?? process.env.RI_DESKTOP_REPO ?? process.cwd();
      const existing = await serviceStatus();
      if (existing && existing.phase !== 'starting' && !existing.origin && existing.role !== 'home') {
        await serviceRequest('/role/refresh', 'POST', 200_000);
      }
      const ready = await ensureServiceStatus({ repo, node: installed?.node ?? process.execPath,
        env: { ...process.env, ...(installed ? { NEXT_DIST_DIR: '.next-desktop', RI_DESKTOP: '1' } : {}), RI_DESKTOP_MODE: options.dev ? 'development' : 'production' } });
      console.info(ready.origin ? `Ri is running at ${ready.origin}\nData: ${ready.identity.root}` : `Ri service: ${ready.role ?? ready.phase}\n${ready.home ? `Home: ${ready.home.url}\n` : ''}Local folder: ${ready.identity.root}`);
    });
  service.command('worker <action>').description('Stop or resume local execution without stopping your Home or viewer')
    .action(async (action: string) => {
      if (!['stop', 'resume'].includes(action)) throw new Error('Choose stop or resume.');
      console.info(JSON.stringify(await serviceRequest(`/worker/${action}`, 'POST', 60_000), null, 2));
    });
  service.command('status').description('Show the verified service identity and state').action(async () => {
    console.info(JSON.stringify(await serviceStatus() ?? { phase: 'stopped', identity: servicePaths().identity }, null, 2));
  });
  service.command('stop').description('Stop the local backend, disconnecting its clients').action(async () => {
    await stopService();
    console.info('Ri service stopped. Your data was retained.');
  });
  service.command('awake [mode]').description('Keep this device awake on external power: on, off, or status')
    .action(async (mode = 'status') => {
      if (!['on', 'off', 'status'].includes(mode)) throw new Error('Choose on, off, or status.');
      const running = await serviceStatus();
      if (!running) {
        if (mode !== 'status') throw new Error('Start the background service before changing keep-awake preferences.');
        console.info(JSON.stringify({ awake: { ...readAwakePreferences(), phase: 'stopped', power: 'unknown', detail: 'The background service is stopped.' } }, null, 2));
        return;
      }
      console.info(JSON.stringify(await serviceRequest('/awake', mode === 'status' ? 'GET' : 'PATCH', 10_000,
        mode === 'status' ? undefined : { enabled: mode === 'on' }), null, 2));
    });
  service.command('configure').description('Inspect or save private service settings. Changes apply on restart.')
    .option('--file <json>', 'JSON file containing the settings to merge')
    .action((options: { file?: string }) => {
      const release = beginActivity();
      try { console.info(JSON.stringify(options.file ? saveEnvironment(JSON.parse(fs.readFileSync(options.file, 'utf8'))) : environmentStatus(), null, 2)); } finally { release(); }
    });
  service.command('logs').description('Show the latest local service log').action(() => {
    const file = servicePaths().log;
    if (!fs.existsSync(file)) { console.info('No service log yet.'); return; }
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const bytes = Buffer.alloc(Math.min(size, 64 * 1024));
      fs.readSync(fd, bytes, 0, bytes.length, Math.max(0, size - bytes.length));
      console.info(bytes.toString());
    } finally { fs.closeSync(fd); }
  });
  service.command('stage <resources>').description('Verify and stage a bundled server/Node runtime outside the application')
    .action((resources: string) => console.info(JSON.stringify(stageRuntime(path.resolve(resources)), null, 2)));
  service.command('manifest <resources>', { hidden: true }).action((resources: string) => {
    console.info(`Runtime manifest: ${createRuntimeManifest(path.resolve(resources)).id}`);
  });
  service.command('verify <resources>').description('Check every runtime file against its manifest')
    .action((resources: string) => console.info(`Verified runtime: ${verifyRuntime(path.resolve(resources)).id}`));
  service.command('install').description('Install the staged runtime as a login service')
    .option('--dry-run', 'show the service definition without installing it')
    .action(async (options: { dryRun?: boolean }) => {
      const job = await installService(options.dryRun);
      console.info(options.dryRun ? job.content : `Installed ${job.file}`);
    });
  service.command('uninstall').description('Remove login supervision and retain all data and installed runtimes')
    .action(async () => { await uninstallService(); console.info('Login service removed. Data and runtimes were retained.'); });
}
