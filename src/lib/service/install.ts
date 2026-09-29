import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { APP_ROOT_ENV, CONFIG_DIR_ENV, DB_PATH_ENV, WORK_DIR_ENV } from '@/lib/config/paths';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { installedRuntime } from './runtime';
import { servicePaths } from './paths';
import { serviceRequest, serviceStatus, stopService } from './client';

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
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array><string>${xml(options.launcher)}</string></array>\n<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join('')}</dict>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n<key>ThrottleInterval</key><integer>30</integer>\n<key>ExitTimeOut</key><integer>30</integer>\n<key>StandardOutPath</key><string>${xml(options.log)}</string>\n<key>StandardErrorPath</key><string>${xml(options.log)}</string>\n</dict></plist>\n` };
  }
  return { label, file: path.join(options.home, '.config/systemd/user', `${label}.service`), content:
    `# Managed by Ri for this data root\n[Unit]\nDescription=Ri background service\nStartLimitIntervalSec=300\nStartLimitBurst=5\n\n[Service]\nType=simple\nExecStart=${unit(options.launcher)}\n${Object.entries(env).map(([key, value]) => `Environment=${unit(`${key}=${value}`)}`).join('\n')}\nRestart=on-failure\nRestartSec=30\nTimeoutStopSec=30\nKillMode=control-group\nUMask=0077\n\n[Install]\nWantedBy=default.target\n` };
}

function definition() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') throw new Error('Background service installation supports macOS and Linux');
  const runtime = installedRuntime();
  if (!runtime) throw new Error('Stage a packaged runtime before installing the login service');
  const paths = servicePaths();
  return serviceDefinition({ platform: process.platform, home: os.homedir(), launcher: runtime.launcher, id: paths.id, ...paths.identity, log: paths.log });
}

export async function installService(dryRun = false) {
  const job = definition();
  if (dryRun) return job;
  // Validate ownership before asking a live backend to drain. A conflicting
  // login definition must not interrupt the otherwise healthy current owner.
  if (fs.existsSync(job.file) && fs.readFileSync(job.file, 'utf8') !== job.content) throw new Error('A different service definition already exists at this path');
  if (fs.existsSync(supervisionRecord()) && fs.existsSync(job.file) && fs.readFileSync(job.file, 'utf8') === job.content) {
    await startInstalledService(); return job;
  }
  if (await serviceStatus()) {
    await serviceRequest('/handoff', 'POST', 10_000);
    const deadline = Date.now() + 30_000;
    while (await serviceStatus()) {
      if (Date.now() > deadline) throw new Error('The current service is still stopping');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  if (fs.existsSync(job.file) && fs.readFileSync(job.file, 'utf8') !== job.content) throw new Error('A different service definition already exists at this path');
  fs.mkdirSync(path.dirname(servicePaths().log), { recursive: true, mode: 0o700 });
  atomicWriteFile(job.file, job.content);
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
  if (fs.readFileSync(job.file, 'utf8') !== job.content) throw new Error('Service definition was modified. It was left unchanged.');
  await stopService();
  if (process.platform === 'darwin') execFileSync('launchctl', ['bootout', `gui/${process.getuid!()}`, job.file], { stdio: 'pipe' });
  else execFileSync('systemctl', ['--user', 'disable', '--now', `${job.label}.service`], { stdio: 'pipe' });
  fs.unlinkSync(job.file);
  fs.rmSync(supervisionRecord(), { force: true });
  if (process.platform === 'linux') execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
}

function supervisionRecord() { return path.join(servicePaths().identity.config, 'service-supervision.json'); }
export function hasLoginSupervision() { return fs.existsSync(supervisionRecord()); }
export async function startInstalledService(): Promise<boolean> {
  if (!hasLoginSupervision()) return false;
  const job = definition();
  if (!fs.existsSync(job.file) || fs.readFileSync(job.file, 'utf8') !== job.content) throw new Error('The registered login service was modified or removed. Reinstall supervision explicitly.');
  if (process.platform === 'darwin') {
    const domain = `gui/${process.getuid!()}`;
    try { execFileSync('launchctl', ['print', `${domain}/${job.label}`], { stdio: 'pipe' }); }
    catch { execFileSync('launchctl', ['bootstrap', domain, job.file], { stdio: 'pipe' }); return true; }
    execFileSync('launchctl', ['kickstart', `${domain}/${job.label}`], { stdio: 'pipe' });
  } else execFileSync('systemctl', ['--user', 'start', `${job.label}.service`], { stdio: 'pipe' });
  return true;
}
