/**
 * Where an agent's folder is on this device (P2.4), as the home records it
 * (docs/homes-spec.md §4.1): the home sends this worker its folders when it
 * connects and whenever they change (`folders`), and this keeps them in
 * memory only. Nothing about an agent's folders is kept on this device.
 * Shared by the worker's command handlers, its reads and changes, and its
 * terminals.
 */

import type { WorkerFolderSetup } from '@/lib/workers/protocol';

const book = new Map<string, string>();
let bookHome: string | null = null;

/** The home's latest word on this device's folders: replaces what it said before. */
export function setAgentFolders(homeId: string, setups: readonly WorkerFolderSetup[]): void {
  bookHome = homeId;
  book.clear();
  for (const setup of setups) book.set(setup.agentId, setup.sourcePath);
}

/** The folder the home records for an agent on this device. */
export function agentFolderHere(homeId: string, agentId: string): string | null {
  if (bookHome !== homeId) return null;
  return book.get(agentId) ?? null;
}

/** For tests: forget them. */
export function _resetAgentFolders(): void {
  book.clear();
  bookHome = null;
}
