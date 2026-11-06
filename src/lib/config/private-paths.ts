import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { untraced } from '@/lib/utils/untraced';

/** Windows mode bits do not describe access. The desktop launch restricts
 * its data directories with NTFS ACLs before reading or creating secrets. */
export function hasPrivatePermissions(stat: fs.Stats, mask = 0o077): boolean {
  return process.platform === 'win32' || (stat.mode & mask) === 0;
}

/** Keep credentials and authored data private to this account and SYSTEM.
 * Numeric SIDs work on Windows installations in any language. */
export function protectWindowsDirectories(directories: string[]): void {
  if (process.platform !== 'win32') return;
  const output = execFileSync(untraced('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const sid = /S-1-5-\d+(?:-\d+)+/.exec(output)?.[0];
  if (!sid) throw new Error('Windows could not identify your account to protect Ri data.');
  for (const directory of new Set(directories)) {
    fs.mkdirSync(/* turbopackIgnore: true */ directory, { recursive: true });
    execFileSync(untraced('icacls.exe'), [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'],
      { stdio: 'pipe', windowsHide: true });
  }
}
