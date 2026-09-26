/**
 * Where an agent's folder is on this computer (P2.4), from the setup files
 * registered here: the one that names this home and the agent. Shared by the
 * worker's command handlers, its reads and changes, and its terminals.
 */

import { readSetupFile } from '@/lib/setups/local-file';
import { listRegisteredLocations } from '@/lib/setups/registry';

/** The folder this computer set up for an agent, from its own setup files. */
export function agentFolderHere(homeId: string, agentId: string): string | null {
  for (const { dir } of listRegisteredLocations()) {
    const read = readSetupFile(dir);
    if (read.state === 'ok' && read.file.homeId === homeId && read.file.agents[agentId]) return dir;
  }
  return null;
}
