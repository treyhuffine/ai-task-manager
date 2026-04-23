/**
 * Consistent DB dump via SQLite's native online backup API.
 *
 * This is the only piece of backup that needs code: SQLite files cannot be
 * safely copied with `cp` or `rclone sync` while the app is writing (torn
 * copy risk). Mirror markdown and attachments are plain files that sync
 * tools handle correctly — callers push those straight from their live
 * directories, no intermediate copy step.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { getRawDb } from '@/lib/db';

/**
 * Write a consistent copy of the DB to `destPath`. Safe under concurrent
 * writes — the DB keeps accepting reads and writes throughout. Creates the
 * destination directory if missing.
 */
export async function backupDb(destPath: string): Promise<void> {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const db = getRawDb();
  await db.backup(destPath);
}
