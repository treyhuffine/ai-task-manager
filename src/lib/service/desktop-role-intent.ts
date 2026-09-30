/** Explicit first-run choice. Reading this marker never opens the application DB. */
import fs from 'node:fs';
import path from 'node:path';
import { getConfigDir } from '@/lib/config/paths';
import { getInstallationRole } from '@/lib/config/role';
import { retiredHomes } from '@/lib/home/retired';
import { atomicWriteFile } from '@/lib/config/atomic-write';

export function desktopHomeIntentPath() { return path.join(getConfigDir(), 'desktop-role.json'); }

export function hasDesktopHomeIntent(): boolean {
  const file = desktopHomeIntentPath();
  let stat: fs.Stats;
  try { stat = fs.lstatSync(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error('The desktop role choice must be a private file owned by this user.');
  }
  const record = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown; role?: unknown };
  if (record.version !== 1 || record.role !== 'home') throw new Error('This desktop role choice is not supported.');
  return true;
}

export function writeDesktopHomeIntent(): void {
  if (getInstallationRole() !== 'fresh' || retiredHomes().length) {
    throw new Error('Choose a new empty installation to start a Home. Existing or retired data was left unchanged.');
  }
  atomicWriteFile(desktopHomeIntentPath(), JSON.stringify({ version: 1, role: 'home' }));
}
