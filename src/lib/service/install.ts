import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { APP_ROOT_ENV, CONFIG_DIR_ENV, DB_PATH_ENV, WORK_DIR_ENV } from '@/lib/config/paths';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { installedRuntime } from './runtime';
import { servicePaths } from './paths';
import { acquireServiceOwner } from './owner';
import { serviceRequest, serviceStatus, stopService } from './client';
import { hasLoginSupervision, supervisionRecord } from './supervision-state';
export { hasLoginSupervision } from './supervision-state';

export interface ServiceDefinitionOptions {
  platform: 'darwin' | 'linux'; home: string; launcher: string;
  id: string; root: string; database: string; config: string; work: string; log: string;
}

function xml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
function unit(value: string) { return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('\n', '\\n').replaceAll('\r', '\\r')}"`; }

export function serviceDefinition(options: ServiceDefinitionOptions) {
  const label = `app.ri.service.${options.id}`;
  const env = {
    [APP_ROOT_ENV]: options.root, [DB_PATH_ENV]: options.database,
    [CONFIG_DIR_ENV]: options.config, [WORK_DIR_ENV]: options.work,
    RI_DESKTOP: '1', RI_DESKTOP_MODE: 'production',
    HOME: options.home, PATH: `${options.home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  };
  if (options.platform === 'darwin') {
    return { label, file: path.join(options.home, 'Library/LaunchAgents', `${label}.plist`), content:
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array><string>${xml(options.launcher)}</string></array>\n<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join('')}</dict>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n<key>ThrottleInterval</key><integer>30</integer>\n<key>ExitTimeOut</key><integer>60</integer>\n<key>StandardOutPath</key><string>${xml(options.log)}</string>\n<key>StandardErrorPath</key><string>${xml(options.log)}</string>\n</dict></plist>\n` };
  }
  return { label, file: path.join(options.home, '.config/systemd/user', `${label}.service`), content:
    `# Managed by Ri for this data root\n[Unit]\nDescription=Ri background service\nStartLimitIntervalSec=300\nStartLimitBurst=5\n\n[Service]\nType=simple\nExecStart=${unit(options.launcher)}\n${Object.entries(env).map(([key, value]) => `Environment=${unit(`${key}=${value}`)}`).join('\n')}\nRestart=on-failure\nRestartSec=30\nTimeoutStopSec=60\nKillMode=control-group\nUMask=0077\n\n[Install]\nWantedBy=default.target\n` };
}

function definition() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') throw new Error('Background service installation supports macOS and Linux');
  const runtime = installedRuntime();
  if (!runtime) throw new Error('Stage a packaged runtime before installing the login service');
  const paths = servicePaths();
  return serviceDefinition({ platform: process.platform, home: os.homedir(), launcher: runtime.launcher, id: paths.id, ...paths.identity, log: paths.log });
}

// Only the immediately preceding Ri template is migratable. All identity,
// launcher, environment, logging and restart settings must still match exactly.
function previousDefinition(job: ReturnType<typeof serviceDefinition>) {
  return process.platform === 'darwin'
    ? job.content.replace('<key>ExitTimeOut</key><integer>60</integer>', '<key>ExitTimeOut</key><integer>30</integer>')
    : job.content.replace('TimeoutStopSec=60\n', 'TimeoutStopSec=30\n');
}
function ownsDefinition(job: ReturnType<typeof serviceDefinition>, content: string) {
  return content === job.content || content === previousDefinition(job);
}
function existingDefinition(job: ReturnType<typeof serviceDefinition>) {
  return fs.existsSync(job.file) ? fs.readFileSync(job.file, 'utf8') : null;
}

export async function installService(dryRun = false) {
  const job = definition();
  if (dryRun) return job;
  // Validate ownership before asking a live backend to drain. A conflicting
  // login definition must not interrupt the otherwise healthy current owner.
  const existing = existingDefinition(job);
  if (existing !== null && !ownsDefinition(job, existing)) throw new Error('A different service definition already exists at this path');
  if (fs.existsSync(supervisionRecord()) && existing === job.content) {
    await startInstalledService(); return job;
  }
  if (await serviceStatus()) {
    await serviceRequest('/handoff', 'POST', 60_000);
    const deadline = Date.now() + 75_000;
    while (await serviceStatus()) {
      if (Date.now() > deadline) throw new Error('The current service is still stopping');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  const afterHandoff = existingDefinition(job);
  if (afterHandoff !== null && !ownsDefinition(job, afterHandoff)) throw new Error('A different service definition already exists at this path');
  // An unreachable but still running controller cannot be safely handed off.
  // Hold its ownership lock through unloading and replacing the old template.
  const releaseOwner = afterHandoff === previousDefinition(job) ? acquireServiceOwner() : undefined;
  try {
    if (afterHandoff === previousDefinition(job)) {
      // The controller accepted handoff before we unload its old definition. A
      // busy backend therefore keeps both its process and login job unchanged.
      if (process.platform === 'darwin') {
        const domain = `gui/${process.getuid!()}`;
        let loaded = false;
        try { execFileSync('launchctl', ['print', `${domain}/${job.label}`], { stdio: 'pipe' }); loaded = true; } catch { /* Already unloaded. */ }
        if (loaded) execFileSync('launchctl', ['bootout', domain, job.file], { stdio: 'pipe' });
      } else execFileSync('systemctl', ['--user', 'stop', `${job.label}.service`], { stdio: 'pipe' });
      if (existingDefinition(job) !== afterHandoff) throw new Error('A different service definition already exists at this path');
    }
    fs.mkdirSync(path.dirname(servicePaths().log), { recursive: true, mode: 0o700 });
    atomicWriteFile(job.file, job.content);
  } finally { releaseOwner?.(); }
  if (process.platform === 'darwin') execFileSync('launchctl', ['bootstrap', `gui/${process.getuid!()}`, job.file], { stdio: 'pipe' });
  else {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
    execFileSync('systemctl', ['--user', 'enable', '--now', `${job.label}.service`], { stdio: 'pipe' });
  }
  atomicWriteFile(supervisionRecord(), JSON.stringify({ version: 1, file: job.file, label: job.label }));
  return job;
}

export async function uninstallService() {
  const job = definition();
  if (!fs.existsSync(job.file)) return;
  const existing = fs.readFileSync(job.file, 'utf8');
  if (!ownsDefinition(job, existing)) throw new Error('Service definition was modified. It was left unchanged.');
  await stopService();
  if (existingDefinition(job) !== existing) throw new Error('Service definition was modified. It was left unchanged.');
  if (process.platform === 'darwin') execFileSync('launchctl', ['bootout', `gui/${process.getuid!()}`, job.file], { stdio: 'pipe' });
  else execFileSync('systemctl', ['--user', 'disable', '--now', `${job.label}.service`], { stdio: 'pipe' });
  fs.unlinkSync(job.file);
  fs.rmSync(supervisionRecord(), { force: true });
  if (process.platform === 'linux') execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
}

export async function startInstalledService(): Promise<boolean> {
  if (!hasLoginSupervision()) return false;
  const job = definition();
  const existing = existingDefinition(job);
  if (existing === null || !ownsDefinition(job, existing)) throw new Error('The registered login service was modified or removed. Reinstall supervision explicitly.');
  if (existing !== job.content) { await installService(); return true; }
  if (process.platform === 'darwin') {
    const domain = `gui/${process.getuid!()}`;
    try { execFileSync('launchctl', ['print', `${domain}/${job.label}`], { stdio: 'pipe' }); }
    catch { execFileSync('launchctl', ['bootstrap', domain, job.file], { stdio: 'pipe' }); return true; }
    execFileSync('launchctl', ['kickstart', `${domain}/${job.label}`], { stdio: 'pipe' });
  } else execFileSync('systemctl', ['--user', 'start', `${job.label}.service`], { stdio: 'pipe' });
  return true;
}
