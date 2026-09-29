/**
 * An agent's folders on the person's computers, as the home records them
 * (docs/homes-spec.md §4.1-4.2): choosing them, checking them where they
 * are, and telling each computer's worker what it has. The records are the
 * only place they're kept. A computer only checks and reports.
 *
 * Every change is recorded first, then sent to that computer's worker and
 * checked there. A computer that isn't connected gets its folders, and
 * checks them, when it next connects (the worker stream's `hello`).
 */

import path from 'node:path';
import {
  foldersToCheck,
  getAgentSetup,
  getComputer,
  getFolderLink,
  getHome,
  getReferenceFolder,
  getWorkspace,
  listAgentSetups,
  listComputers,
  listEnrolledComputerIds,
  listFolderLinks,
  listReferenceFoldersForWorkspace,
  recordFolderChecks,
  removeAgentSetup,
  setAgentFolder,
  setFolderLink,
  updateWorkspace,
} from '@/lib/db/queries';
import { isComputerConnected, requestWorker, sendToWorker, WorkerUnavailableError } from '@/lib/workers/hub';
import type { WorkerFolderSetup } from '@/lib/workers/protocol';
import { checkFoldersHere, listFoldersHere, type FolderListing, FolderListingError } from './folders-here';

export class FoldersUnavailableError extends Error {}

/** A folder change that can't be made, with why: shown to the person as it is. */
export class FolderError extends Error {}

/** A folder chosen on a computer that isn't there. */
export class FolderNotThereError extends FolderError {}

function isHost(computerId: string): boolean {
  return getHome()?.hostComputerId === computerId;
}

function nameOf(computerId: string): string {
  return getComputer(computerId)?.name ?? 'That computer';
}

/** A computer's folders, as its worker is told them. */
export function folderSetupsFor(computerId: string): WorkerFolderSetup[] {
  return listAgentSetups({ computerId }).map((s) => ({ agentId: s.workspaceId, sourcePath: s.sourcePath }));
}

/** Tell a computer's worker its folders, now. Nothing to do for the home, or a computer that isn't connected. */
export function announceFolders(computerId: string): void {
  if (isHost(computerId)) return;
  sendToWorker(computerId, { type: 'folders', setups: folderSetupsFor(computerId) });
}

/**
 * Check a computer's folders where they are, and record what it found. The
 * home looks at its own disk. A computer elsewhere is asked through its
 * worker, and one that isn't connected is checked when it next connects.
 * Says whether it was checked.
 */
export async function checkComputerFolders(computerId: string, opts: { timeoutMs?: number } = {}): Promise<boolean> {
  const paths = foldersToCheck(computerId);
  if (paths.length === 0) return true;
  if (isHost(computerId)) {
    recordFolderChecks(computerId, checkFoldersHere(paths));
    return true;
  }
  if (!isComputerConnected(computerId)) return false;
  try {
    const answer = (await requestWorker(computerId, 'check_folders', { paths }, opts.timeoutMs ?? 15_000)) as {
      status: number;
      body: { results?: Array<{ path: string; exists: boolean }> };
    };
    if (answer.status !== 200 || !answer.body.results) return false;
    recordFolderChecks(computerId, answer.body.results);
    return true;
  } catch {
    return false;
  }
}

/** Check the home's own folders: after a linked folder's place on the home changes. */
export async function checkHomeFolders(): Promise<void> {
  const host = getHome()?.hostComputerId;
  if (host) await checkComputerFolders(host);
}

/** A folder's folders on a computer, for choosing one: the home's own, or through its worker. */
export async function listComputerFolders(computerId: string, at: string | null): Promise<FolderListing> {
  if (isHost(computerId)) return listFoldersHere(at);
  const name = nameOf(computerId);
  let answer: { status: number; body: unknown };
  try {
    answer = (await requestWorker(computerId, 'list_folders', { path: at }, 15_000)) as { status: number; body: unknown };
  } catch (err) {
    if (err instanceof WorkerUnavailableError) {
      throw new FoldersUnavailableError(`${name} isn't running Ri right now, so its folders can't be listed. Type the path instead.`);
    }
    throw new FoldersUnavailableError(`${name} couldn't list its folders: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (answer.status !== 200) {
    throw new FolderListingError((answer.body as { message?: string } | null)?.message ?? `${name} couldn't list that folder.`);
  }
  return answer.body as FolderListing;
}

/** Record, tell the computer, and check there. */
async function afterChange(computerId: string): Promise<void> {
  announceFolders(computerId);
  await checkComputerFolders(computerId);
}

/**
 * A folder as the person typed it, for a computer: absolute, with `~` as
 * that computer's home folder (asked of it, since it isn't the home's), and
 * there, when the computer can say. A computer that isn't connected takes it
 * as it is, and checks it when it's back.
 */
export async function folderOn(computerId: string, typed: string): Promise<string> {
  const t = typed.trim();
  if (!t) throw new FolderNotThereError('Choose a folder.');
  let folder = t;
  if (t === '~' || t.startsWith('~/')) {
    const home = (await listComputerFolders(computerId, null).catch(() => null))?.home;
    if (!home) throw new FolderNotThereError(`${nameOf(computerId)} isn't running Ri right now, so a path from its home folder can't be worked out. Type the whole path.`);
    folder = t === '~' ? home : path.join(home, t.slice(2));
  }
  if (!path.isAbsolute(folder)) throw new FolderNotThereError('Type the whole path, from / or ~.');
  folder = path.resolve(folder);
  const there = await folderThere(computerId, folder);
  if (there === false) throw new FolderNotThereError(`${folder} isn't a folder on ${nameOf(computerId)}.`);
  return folder;
}

/** Whether a folder is there on a computer: null when it can't be asked now. */
async function folderThere(computerId: string, folder: string): Promise<boolean | null> {
  if (isHost(computerId)) return checkFoldersHere([folder])[0]!.exists;
  if (!isComputerConnected(computerId)) return null;
  try {
    const answer = (await requestWorker(computerId, 'check_folders', { paths: [folder] }, 15_000)) as {
      status: number;
      body: { results?: Array<{ exists: boolean }> };
    };
    return answer.status === 200 ? (answer.body.results?.[0]?.exists ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * The agent's project folder on a computer. On the home it's also the
 * agent's folder for the rest of the app, which its live sessions read when
 * they start, so they're restarted into it, as changing it in the agent's
 * settings does.
 */
export async function chooseAgentFolder(workspaceId: string, computerId: string, folder: string): Promise<void> {
  const chosen = await folderOn(computerId, folder);
  const before = getAgentSetup(workspaceId, computerId)?.sourcePath ?? null;
  setAgentFolder(workspaceId, computerId, chosen);
  await afterChange(computerId);
  if (isHost(computerId) && before !== chosen) {
    const { recycleWorkspaceSessions } = await import('@/lib/executor/adapter');
    await recycleWorkspaceSessions(workspaceId);
  }
}

/**
 * Where a linked folder is on a computer, or null to go without it there.
 * Live sessions that use it read their linked folders when they start, so
 * they're restarted to see the change, as editing it always did.
 */
export async function chooseLinkedFolder(referenceFolderId: string, computerId: string, folder: string | null): Promise<void> {
  const chosen = folder === null ? null : await folderOn(computerId, folder);
  const before = getFolderLink(computerId, referenceFolderId);
  setFolderLink(computerId, referenceFolderId, chosen);
  await afterChange(computerId);
  if (!before || before.path !== chosen) {
    const ref = getReferenceFolder(referenceFolderId);
    const { recycleForReferenceFolderChange } = await import('@/lib/executor/adapter');
    if (ref) await recycleForReferenceFolderChange(ref.workspaceId);
  }
}

// ─── An agent's folders across the person's computers, for the Setup tab ───

export type LinkedFolderState = 'found' | 'missing' | 'unchecked' | 'omitted' | 'unchosen';

export interface LinkedFolderOn {
  referenceFolderId: string;
  alias: string;
  description: string | null;
  /** For every agent, rather than this one. */
  forEveryAgent: boolean;
  /** Another agent's project folder, rather than a folder. */
  agent: { id: string; name: string } | null;
  path: string | null;
  state: LinkedFolderState;
  problem: string | null;
}

export interface AgentFoldersOn {
  computerId: string;
  name: string;
  isHome: boolean;
  /** Its worker is connected now. The home always is. */
  connected: boolean;
  /** The agent's project folder there, or null when it isn't set up there yet. */
  setup: { folder: string; status: string; problem: string | null; found: boolean | null } | null;
  linked: LinkedFolderOn[];
}

/**
 * An agent's folders on each of the person's computers that runs agents:
 * the home first, then the others by name. Each has its project folder, if
 * the agent is set up there, and each linked folder with its place there.
 */
export function agentFoldersEverywhere(workspaceId: string): AgentFoldersOn[] {
  const ws = getWorkspace(workspaceId);
  if (!ws) return [];
  const host = getHome()?.hostComputerId ?? null;
  const enrolled = listEnrolledComputerIds();
  const computers = listComputers()
    .filter((c) => c.status === 'active' && (c.id === host || enrolled.has(c.id)))
    .sort((a, b) => Number(b.id === host) - Number(a.id === host) || a.name.localeCompare(b.name));
  const refs = listReferenceFoldersForWorkspace(workspaceId);
  return computers.map((computer) => {
    const setup = getAgentSetup(workspaceId, computer.id);
    const recorded = new Map((setup?.references ?? []).map((r) => [r.alias, r]));
    const links = new Map(listFolderLinks({ computerId: computer.id }).map((l) => [l.referenceFolderId, l]));
    const linked: LinkedFolderOn[] = refs.map((ref) => {
      const target = ref.targetWorkspaceId ? getWorkspace(ref.targetWorkspaceId) : null;
      const base = {
        referenceFolderId: ref.id,
        alias: ref.alias,
        description: ref.description ?? null,
        forEveryAgent: ref.workspaceId === null,
        agent: target ? { id: target.id, name: target.name } : null,
      };
      if (ref.targetWorkspaceId) {
        const there = getAgentSetup(ref.targetWorkspaceId, computer.id);
        return {
          ...base,
          path: there?.sourcePath ?? null,
          state: !there ? ('unchosen' as const) : there.found === false ? ('missing' as const) : there.found ? ('found' as const) : ('unchecked' as const),
          problem: recorded.get(ref.alias)?.problem ?? null,
        };
      }
      const link = links.get(ref.id) ?? getFolderLink(computer.id, ref.id);
      const state: LinkedFolderState = !link ? 'unchosen' : link.path === null ? 'omitted' : link.found === true ? 'found' : link.found === false ? 'missing' : 'unchecked';
      return { ...base, path: link?.path ?? null, state, problem: recorded.get(ref.alias)?.problem ?? null };
    });
    return {
      computerId: computer.id,
      name: computer.name,
      isHome: computer.id === host,
      connected: computer.id === host || isComputerConnected(computer.id),
      setup: setup ? { folder: setup.sourcePath, status: setup.status, problem: setup.problem, found: setup.found } : null,
      linked,
    };
  });
}

/**
 * Take an agent off a computer. Not the home: its folder there is where the
 * agent lives, so it's changed rather than removed.
 */
export async function removeFromComputer(workspaceId: string, computerId: string): Promise<boolean> {
  if (isHost(computerId)) {
    throw new FolderError(`${nameOf(computerId)} is your Ri's home, so the agent always has a folder there. Change it instead, or archive the agent.`);
  }
  const removed = removeAgentSetup(workspaceId, computerId);
  // New work there would only ask to set it up again: it starts on the home instead.
  if (getWorkspace(workspaceId)?.defaultComputerId === computerId) updateWorkspace(workspaceId, { defaultComputerId: null });
  announceFolders(computerId);
  return removed;
}
