/**
 * Moving a home to another computer (docs/homes-spec.md §10.3, P5.3): "a
 * guided, stopped export/import", with the same home id, and the old host
 * retired before the new one takes over.
 *
 * 1. On the old host, stopped: `ri home export <dir>`, a verified backup.
 * 2. On the new host, in a folder of its own: `ri home import <dir>`. The
 *    home is there but not active: a restored home waits to be claimed.
 * 3. On the old host: `ri home retire`, so it never runs beside the new one.
 * 4. On the new host: `ri home claim`, naming which computer of the home this
 *    is (`moveHomeHost` pins what ran on the old host to it), then `ri start`.
 * 5. The old host connects to the new home (`ri connect`) and can enroll as a
 *    worker in the same folder, its worktrees where they were. Other
 *    computers keep their identity and follow a new address with
 *    `ri connect --address <url>`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getAppRoot, getConnectionPath, getDbPath } from '@/lib/config/paths';
import { createHomeBackup, restoreHomeBackup, verifyHomeBackup, type BackupManifest } from './backup';
import { assertStopped, RetireError } from './retire';

export class MoveError extends Error {}

/** Export the stopped home in this folder to `outDir`, verified. */
export async function exportHome(outDir: string): Promise<BackupManifest> {
  const dbPath = getDbPath();
  if (fs.existsSync(getConnectionPath()) || !fs.existsSync(dbPath)) throw new MoveError('This folder has no home to export.');
  try {
    assertStopped(dbPath, 'export it');
  } catch (err) {
    if (err instanceof RetireError) throw new MoveError(err.message);
    throw err;
  }
  const target = path.resolve(outDir);
  if (target === path.resolve(getAppRoot()) || target.startsWith(path.resolve(getAppRoot()) + path.sep)) {
    throw new MoveError('Export it outside this folder.');
  }
  const manifest = await createHomeBackup({ root: getAppRoot(), outDir: target });
  const verified = verifyHomeBackup(target);
  if (!verified.ok) throw new MoveError(`The export doesn't verify:\n  ${verified.problems.join('\n  ')}`);
  return manifest;
}

/** Import an exported home into this folder, which must have none. It waits to be claimed. */
export function importHome(backupDir: string): BackupManifest {
  if (fs.existsSync(getConnectionPath())) {
    throw new MoveError('This folder is connected to a home elsewhere. Import into a folder of its own.');
  }
  if (fs.existsSync(getDbPath())) throw new MoveError('This folder already has a home. Import into a folder of its own.');
  return restoreHomeBackup({ backupDir: path.resolve(backupDir), root: getAppRoot() });
}
