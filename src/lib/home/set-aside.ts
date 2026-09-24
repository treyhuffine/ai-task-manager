/**
 * Setting aside a home that was started by mistake (docs/homes-spec.md §3.1:
 * connecting must never silently create a home, and a first-run choice is
 * never a trap).
 *
 * Someone who meant to connect this computer to their existing Ri, but
 * started a new one here, can connect instead as long as the new home is
 * still empty: no tasks, notes, agents, stream items or chats, and
 * onboarding not finished. Its database and identity are moved into
 * `<root>/.set-aside/<time>/`. Nothing is deleted, and a home with anything
 * in it is never touched.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getAppRoot, getDbPath, getMachineIdentityPath } from '@/lib/config/paths';
import { withSourceDatabase } from './source-db';

const COUNTED = ['tasks', 'notes', 'workspaces', 'stream', 'chat_sessions'] as const;

export function describeHomeUse(): { unused: boolean; counts: Record<string, number>; onboarded: boolean } {
  return withSourceDatabase(getDbPath(), (db) => {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name),
    );
    const counts: Record<string, number> = {};
    for (const t of COUNTED) {
      counts[t] = tables.has(t) ? (db.prepare(`SELECT count(*) AS n FROM "${t}"`).get() as { n: number }).n : 0;
    }
    const onboarded = tables.has('user_state')
      ? Boolean((db.prepare('SELECT onboarded_at FROM user_state LIMIT 1').get() as { onboarded_at: string | null } | undefined)?.onboarded_at)
      : false;
    return { unused: !onboarded && Object.values(counts).every((n) => n === 0), counts, onboarded };
  });
}

/** Move an unused home's database and identity aside. Returns where they went. */
export function setAsideUnusedHome(): string {
  const use = describeHomeUse();
  if (!use.unused) throw new Error('This home has data in it, so it was left as it is.');
  const dest = path.join(getAppRoot(), '.set-aside', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  const db = getDbPath();
  for (const file of [db, `${db}-wal`, `${db}-shm`, getMachineIdentityPath()]) {
    if (fs.existsSync(file)) fs.renameSync(file, path.join(dest, path.basename(file)));
  }
  return dest;
}
