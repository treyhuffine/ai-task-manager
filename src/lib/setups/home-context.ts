/**
 * The home computer's own folder for an agent (docs/homes-spec.md §4.1): what
 * creating an agent, or changing its folder, records for the home. The
 * home's records are the only place it's kept, with `workspaces.cwd` kept
 * equal for the rest of the app.
 */

import fs from 'node:fs';
import path from 'node:path';
import { setAgentFolder } from '@/lib/db/queries';
import { ensureHomeIdentity } from '@/lib/home/identity';
import { SetupError } from './set-up-here';
import { checkComputerFolders } from './folders';

export { SetupError };

/** A folder the home can use for an agent: one that's there, as a folder. Returns it absolute. */
export function assertHomeFolderUsable(folder: string): string {
  const dir = path.resolve(folder);
  let isDir = false;
  try {
    isDir = fs.statSync(dir).isDirectory();
  } catch {
    /* missing */
  }
  if (!isDir) throw new SetupError(`${dir} doesn't exist or isn't a folder.`);
  return dir;
}

/**
 * Record an agent's folder on the home. `finish` is the caller's own last
 * step (saving the agent): if it throws, the folder isn't recorded.
 */
export async function setHomeFolder(workspaceId: string, folder: string, opts: { finish?: () => unknown } = {}): Promise<void> {
  const dir = assertHomeFolderUsable(folder);
  await opts.finish?.();
  const host = ensureHomeIdentity().computer.id;
  setAgentFolder(workspaceId, host, dir);
  await checkComputerFolders(host);
}
