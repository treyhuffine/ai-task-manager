/**
 * Which Home a command means (docs/always-on-spec.md section 3.4). The
 * installation records its Homes, so a command needs `--root` only to name a
 * second one: with one Home it means that one, wherever its folder is, and
 * with several it means the personal Home.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getProductionAppRoot } from '@/lib/config/paths';
import { readTeamIntent } from '@/lib/home/team-intent';
import { canonical } from './paths';
import { listHomes, type InstalledHome } from './store';

export type RecordedHome = InstalledHome & { identity: NonNullable<InstalledHome['identity']> };

function present(homes: InstalledHome[]): RecordedHome[] {
  return homes.filter((home): home is RecordedHome => !!home.identity && fs.existsSync(/* turbopackIgnore: true */ home.identity.root));
}

function isTeam(home: RecordedHome) {
  try { return !!readTeamIntent(home.identity.config); } catch { return false; }
}

/** The Home a command about one Home acts on when it isn't told. */
export function defaultHome(homes: InstalledHome[] = listHomes()): RecordedHome | null {
  const known = present(homes);
  if (known.length <= 1) return known[0] ?? null;
  const production = canonical(getProductionAppRoot());
  return known.find(home => home.identity.root === production) ?? known.find(home => !isTeam(home)) ?? known[0];
}

/** The recorded Home in `root`, or null if this installation doesn't run one there. */
export function homeAtRoot(root: string, homes: InstalledHome[] = listHomes()): RecordedHome | null {
  const wanted = canonical(path.resolve(/* turbopackIgnore: true */ root.replace(/^~(?=$|\/)/, process.env.HOME ?? '~')));
  return present(homes).find(home => home.identity.root === wanted) ?? null;
}
