import fs from 'node:fs';
import path from 'node:path';
import { getAppRoot, getProductionAppRoot, getDevAppRoot } from '@/lib/config/paths';
import { registeredPersonalRoots } from '@/lib/home/root-registry';
import { readTeamIntent } from '@/lib/home/team-intent';

export { SHARED_COMPUTER_WARNING } from './shared-computer-copy';

/** Only file metadata is inspected. No personal database, content or credentials are opened. */
export function teamSharesPersonalComputer(options: { roots?: string[]; currentRoot?: string; recorded?: boolean } = {}): boolean {
  if (options.recorded ?? readTeamIntent()?.hostedWithPersonalHome) return true;
  const current = path.resolve(/* turbopackIgnore: true */ options.currentRoot ?? getAppRoot());
  for (const root of options.roots ?? [...registeredPersonalRoots(), getProductionAppRoot(), getDevAppRoot()]) {
    if (path.resolve(/* turbopackIgnore: true */ root) === current) continue;
    try {
      const stat = fs.statSync(root);
      if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) continue;
      if (fs.existsSync(path.join(/* turbopackIgnore: true */ root, '.config', 'team.json'))) continue;
      if (fs.existsSync(path.join(/* turbopackIgnore: true */ root, 'data.db')) || fs.existsSync(path.join(/* turbopackIgnore: true */ root, '.config', 'desktop-role.json'))) return true;
    } catch { /* A missing or inaccessible personal root does not block Team AI. */ }
  }
  return false;
}
