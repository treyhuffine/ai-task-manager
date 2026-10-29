/**
 * What the OS decides about a Home coming back, and what `ri doctor` says
 * about it (docs/always-on-spec.md section 6.5). Each check reads one OS
 * setting through `run`, so tests give the output each OS prints.
 */
import os from 'node:os';
import path from 'node:path';

export interface OsCheck { name: string; ok: boolean; warn?: boolean; detail: string }

/** Runs a command and returns its output, or null when it failed. */
export type Run = (command: string, args: string[]) => string | null;

const GiB = 1024 ** 3;

export function macChecks(run: Run, user = os.userInfo().username): OsCheck[] {
  const checks: OsCheck[] = [];
  const autoLogin = run('/usr/bin/defaults', ['read', '/Library/Preferences/com.apple.loginwindow', 'autoLoginUser'])?.trim();
  checks.push(autoLogin === user
    ? { name: 'Automatic login', ok: true, detail: `on for ${user}, so Ri comes back after a restart or power cut` }
    : { name: 'Automatic login', ok: true, warn: true, detail: `${autoLogin ? `on for ${autoLogin}, not ${user}` : 'off'}. After a restart or power cut, Ri waits until ${user} logs in. Turn it on in System Settings > Users & Groups for a Mac nobody sits at` });
  const fileVault = run('/usr/bin/fdesetup', ['status']);
  if (fileVault?.includes('FileVault is On')) {
    checks.push({ name: 'FileVault', ok: true, warn: true, detail: 'on. After an unplanned restart nothing starts until someone unlocks the disk. For a planned restart: sudo fdesetup authrestart' });
  } else if (fileVault) checks.push({ name: 'FileVault', ok: true, detail: 'off' });
  const power = run('/usr/bin/pmset', ['-g']);
  if (power) {
    const setting = (name: string) => new RegExp(`^\\s*${name}\\s+(\\d+)`, 'm').exec(power)?.[1];
    const autorestart = setting('autorestart');
    if (autorestart !== undefined) checks.push(autorestart === '1'
      ? { name: 'Restart after power failure', ok: true, detail: 'on' }
      : { name: 'Restart after power failure', ok: true, warn: true, detail: 'off, so the Mac stays off after a power cut. To turn it on: sudo pmset -a autorestart 1' });
    const sleep = setting('sleep');
    if (sleep !== undefined) checks.push(sleep === '0'
      ? { name: 'Sleep', ok: true, detail: 'never' }
      : { name: 'Sleep', ok: true, warn: true, detail: `after ${sleep} min idle, which pauses Ri. To keep the Mac awake on power: ri service awake on` });
  }
  return checks;
}

export function linuxChecks(run: Run, user = os.userInfo().username): OsCheck[] {
  const linger = run('loginctl', ['show-user', user, '--property=Linger'])?.trim();
  if (!linger) return [];
  return [linger === 'Linger=yes'
    ? { name: 'Start at boot (linger)', ok: true, detail: `on for ${user}` }
    : { name: 'Start at boot (linger)', ok: true, warn: true, detail: `off, so Ri starts only once ${user} logs in. To start it at boot: sudo loginctl enable-linger ${user}` }];
}

/** Below the larger of 20 GiB or the database's size a full disk is close,
 * and an update's snapshot needs room (sections 6.5 and 7.4). */
export function diskCheck(free: number, database: number): OsCheck {
  const needed = Math.max(20 * GiB, database);
  const shown = (bytes: number) => `${(bytes / GiB).toFixed(1)} GiB`;
  return free >= needed
    ? { name: 'Free disk space', ok: true, detail: `${shown(free)} free` }
    : { name: 'Free disk space', ok: free >= 2 * GiB, warn: free >= 2 * GiB, detail: `${shown(free)} free, under ${shown(needed)}. A full disk takes Ri down, and an update's snapshot needs room` };
}

/** Which `ri` a terminal runs: the launcher, or something that hides it. */
export function commandCheck(resolved: string | null, launcher: string, installed: boolean): OsCheck {
  const name = 'The ri command';
  const shown = launcher.replace(os.homedir(), '~');
  if (resolved === launcher) return { name, ok: true, detail: shown };
  if (!installed) {
    return resolved
      ? { name, ok: true, warn: true, detail: `${resolved} runs, and the launcher isn't installed. \`ri update\` installs it at ${shown}` }
      : { name, ok: true, warn: true, detail: `not installed. \`ri update\` installs it at ${shown}` };
  }
  if (!resolved) return { name, ok: true, warn: true, detail: `${path.dirname(shown)} isn't on the PATH, so a terminal can't find ri. Add it to your shell's PATH` };
  if (resolved === '/usr/bin/ri') return { name, ok: true, warn: true, detail: `/usr/bin/ri, Ruby's documentation tool, comes first. Put ${path.dirname(shown)} before /usr/bin in your shell's PATH` };
  return { name, ok: true, warn: true, detail: `${resolved} runs instead of ${shown}. Remove it, or put ${path.dirname(shown)} first in your PATH` };
}
