/**
 * Local snapshot — point-in-time, dated artifact on disk.
 *
 * Writes `<app-root>/snapshots/<app>-snapshot-<ISO-timestamp>/` containing:
 *   - `data.db`  — consistent online dump via `backupDb()`
 *   - `mirror/`  — copy of the live markdown mirror (tasks, notes, areas,
 *                  stream, .archive). Excludes attachments by design to keep
 *                  local disk small; the mirror itself has wiki-links so it
 *                  reads well standalone.
 *
 * Distinct from:
 *   - the live mirror (`src/lib/export/mirror`), which is always-current and
 *     overwritten in place
 *   - the remote backup (`scripts/backup.ts`), which pushes to the cloud
 *
 * Restore: stop the app, copy `<snapshot>/data.db` → `<brain>/data.db`,
 * restart. The mirror regenerates on the next write via reconcile.
 */

import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { backupDb } from '@/lib/backup';
import { getAppRoot, getBrainDir } from '@/lib/config/paths';
import { ENTITY_TYPES } from './mirror/config';
import { APP_SHORT_ID } from '@/constants/app';

export interface SnapshotOptions {
  /** Parent dir for the dated snapshot folder. Default: `<app-root>/snapshots/`. */
  outRoot?: string;
  /** Exact output directory, bypassing the dated-folder convention. */
  outDir?: string;
}

export interface SnapshotResult {
  /** Absolute path to the snapshot folder. */
  dir: string;
  /** Bytes written for the DB dump (useful for logs). */
  dbBytes: number;
  /** Markdown files copied into mirror/. */
  mirrorFileCount: number;
}

/**
 * Filesystem-safe ISO-ish timestamp: `2026-04-22T15-03-42Z`. Colons → dashes.
 * Matches the `scripts/backup.ts` pattern so folder names sort identically.
 */
function timestamp(): string {
  return new Date().toISOString().replace(/:/g, '-').replace(/\.\d+/, '');
}

/**
 * Write a snapshot folder. Caller is responsible for flushing the mirror
 * (via `reconcileAll()`) first if they want the markdown fully current —
 * this function just captures whatever is on disk right now.
 */
export async function createSnapshot(opts: SnapshotOptions = {}): Promise<SnapshotResult> {
  const outRoot = opts.outRoot ?? path.join(getAppRoot(), 'snapshots');
  const dir = path.resolve(opts.outDir ?? path.join(outRoot, `${APP_SHORT_ID}-snapshot-${timestamp()}`));
  await fsp.mkdir(dir, { recursive: true });

  // DB: consistent online dump.
  const dbDest = path.join(dir, 'data.db');
  await backupDb(dbDest);
  const dbStat = await fsp.stat(dbDest);

  // Mirror: copy each type dir + .archive explicitly. Avoids accidentally
  // picking up attachments/, stray data.db, tmp/, etc. from brain root.
  const mirrorDest = path.join(dir, 'mirror');
  await fsp.mkdir(mirrorDest, { recursive: true });

  const brain = getBrainDir();
  let mirrorFileCount = 0;

  for (const type of ENTITY_TYPES) {
    const src = path.join(brain, `${type}s`);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(mirrorDest, `${type}s`);
    await fsp.cp(src, dest, { recursive: true, force: true, errorOnExist: false });
    mirrorFileCount += await countMd(dest);
  }

  const archiveSrc = path.join(brain, '.archive');
  if (fs.existsSync(archiveSrc)) {
    const archiveDest = path.join(mirrorDest, '.archive');
    await fsp.cp(archiveSrc, archiveDest, { recursive: true, force: true, errorOnExist: false });
    mirrorFileCount += await countMd(archiveDest);
  }

  // README explaining how to restore, so future-you doesn't have to remember.
  await fsp.writeFile(path.join(dir, 'README.md'), restoreReadme(), 'utf8');

  return { dir, dbBytes: dbStat.size, mirrorFileCount };
}

function restoreReadme(): string {
  return `# ${APP_SHORT_ID} snapshot

Created: ${new Date().toISOString()}

## Contents

- \`data.db\`: consistent SQLite dump
- \`mirror/\`: markdown copy of tasks, notes, areas, stream, .archive
  at the time of this snapshot. Wiki-linked in Obsidian-compatible format.

## Restore

1. Stop ${APP_SHORT_ID}.
2. Copy \`data.db\` → \`<brain>/data.db\` (replaces the live DB).
3. Start ${APP_SHORT_ID}. The markdown mirror regenerates on the next write
   via reconcile.

Note: attachments are **not** in this snapshot. For full restoration
including binary files, restore attachments separately from your cloud
backup (with S3 versioning if you need point-in-time).
`;
}

async function countMd(dir: string): Promise<number> {
  let count = 0;
  async function walk(d: string): Promise<void> {
    const entries = await fsp.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.tmp')) continue;
        await walk(p);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        count++;
      }
    }
  }
  await walk(dir);
  return count;
}
