import { openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import path from 'node:path';
import { getLocalAppsDir, getAppDraftsDir } from '@/lib/config/paths';
/** Bounded display metadata only. Never imports package code or starts validation workers. */
export function localAppMetadata(id: string, draft = false) {
  let fd: number | undefined;
  try {
    fd = openSync(path.join(draft ? getAppDraftsDir() : getLocalAppsDir(), id, 'package/plugin.json'), 'r');
    if (fstatSync(fd).size > 65536) return null;
    const manifest = JSON.parse(readFileSync(fd, 'utf8'));
    const extension = manifest.extensions?.['com.ri'];
    const name = extension?.displayName ?? manifest.name;
    return { displayName: typeof name === 'string' ? name.slice(0, 160) : undefined, hasView: !!extension?.ui, hasActions: extension?.runtime?.kind === 'node' };
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}
