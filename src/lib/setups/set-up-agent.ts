/**
 * The home's side of setting an agent up on a device from the app
 * (docs/homes-model.md): what the device needs to know, which only the
 * home has, running it there, and recording what it put in place (docs/
 * homes-spec.md §4.1: the home's records are the only place an agent's
 * folders are kept). The home's own device runs it in-process, a connected
 * device through its worker.
 *
 * What a copy comes from: the Git remote of the agent's folder on the home.
 * Where its linked folders go: where another agent there already has them,
 * or beside it where they are on the home, copied from their own remotes.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  getWorkspaceSetup,
  getDevice,
  getFolderLink,
  getHome,
  getWorkspace,
  listWorkspaceSetups,
  listReferenceFoldersForWorkspace,
  setAgentFolder,
  setFolderLink,
} from '@/lib/db/queries';
import { requestWorker, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import { announceFolders, checkDeviceFolders } from './folders';
import {
  applySetupHere,
  planSetupHere,
  SetupError,
  type SetupAgentRequest,
  type SetupPlanHere,
  type SetupRequestReference,
  type SetupResultHere,
} from './set-up-here';

const run = promisify(execFile);

/** Copying can take minutes. Asking where it would go takes a moment. */
const APPLY_TIMEOUT_MS = 11 * 60_000;

export interface SetupAgentInput {
  how: 'copy' | 'existing';
  /** A folder on that device. Null: the default place, for a copy. */
  folder?: string | null;
  /** Folders for linked folders that couldn't be found, or null to go without. */
  answers?: Record<string, string | null>;
}

/** What setting it up there would do, for the dialog to say before it does it. */
export interface SetupAgentPlan extends SetupPlanHere {
  agentName: string;
  deviceName: string;
  /** Where a copy comes from. Null: only a folder already there can be used. */
  remote: string | null;
  /** The linked folders it uses, and whether setting up brings each along. */
  references: { alias: string; description: string | null; comesAlong: boolean }[];
}

/** What setting it up answers: its setup there now, and where the agent can run. */
export interface SetupOutcome {
  folder: string;
  status: string;
  problem: string | null;
  /** Linked folders still not chosen there, for the person to answer. */
  missing: { alias: string; description: string | null }[];
  copied: string[];
  runOn: import('./run-on').RunOn | null;
}

export class SetupUnavailableError extends Error {}

export async function planSetup(workspaceId: string, deviceId: string): Promise<SetupAgentPlan> {
  const request = await requestFor(workspaceId, deviceId, 'plan', { how: 'copy' });
  const here = (await runOn(deviceId, request, 15_000)) as SetupPlanHere;
  return {
    ...here,
    agentName: request.agentName,
    deviceName: getDevice(deviceId)?.name ?? 'That device',
    remote: request.remote,
    references: request.references.map((r) => ({
      alias: r.alias,
      description: r.description,
      comesAlong: r.omitted || !!r.agentId || !!r.knownPath || (!!r.relativePath && !!r.remote),
    })),
  };
}

/**
 * Put the agent's folders in place on that device, and record them: its
 * project folder, and where each linked folder is. A linked folder every
 * agent uses that already has a place there keeps it, unless the person
 * chose another (their answer). Then that device is told and checks them.
 */
export async function applySetup(
  workspaceId: string,
  deviceId: string,
  input: SetupAgentInput,
): Promise<Omit<SetupOutcome, 'runOn'>> {
  const request = await requestFor(workspaceId, deviceId, 'apply', input);
  const result = (await runOn(deviceId, request, APPLY_TIMEOUT_MS)) as SetupResultHere;
  setAgentFolder(workspaceId, deviceId, result.folder);
  for (const ref of listReferenceFoldersForWorkspace(workspaceId)) {
    if (ref.targetWorkspaceId || !(ref.alias in result.links)) continue;
    const place = result.links[ref.alias]!;
    const answered = input.answers?.[ref.alias] !== undefined;
    const current = getFolderLink(deviceId, ref.id);
    if (current && !answered) continue;
    setFolderLink(deviceId, ref.id, place);
  }
  announceFolders(deviceId);
  await checkDeviceFolders(deviceId);
  const setup = getWorkspaceSetup(workspaceId, deviceId)!;
  const descriptions = new Map(request.references.map((r) => [r.alias, r.description]));
  return {
    folder: setup.sourcePath,
    status: setup.status,
    problem: setup.problem,
    missing: setup.references
      .filter((r) => r.form === 'unconfigured')
      .map((r) => ({ alias: r.alias, description: descriptions.get(r.alias) ?? null })),
    copied: result.copied,
  };
}

async function runOn(deviceId: string, request: SetupAgentRequest, timeoutMs: number): Promise<unknown> {
  if (deviceId === getHome()?.hostDeviceId) {
    return request.op === 'plan' ? planSetupHere(request) : applySetupHere(request);
  }
  const name = getDevice(deviceId)?.name ?? 'That device';
  let answer: { status: number; body: unknown };
  try {
    answer = (await requestWorker(deviceId, 'setup_agent', request, timeoutMs)) as { status: number; body: unknown };
  } catch (err) {
    if (err instanceof WorkerUnavailableError) {
      throw new SetupUnavailableError(`${name} isn't running Ri right now. Start it there, then try again.`);
    }
    if (err instanceof WorkerRequestError && /doesn't know the request/.test(err.message)) {
      throw new SetupUnavailableError(`${name} has an older Ri that can't set agents up from here. Update Ri on ${name}.`);
    }
    throw err;
  }
  if (answer.status !== 200) {
    const message = (answer.body as { message?: string } | null)?.message ?? `${name} couldn't set it up.`;
    throw new SetupError(message);
  }
  return answer.body;
}

async function requestFor(
  workspaceId: string,
  deviceId: string,
  op: 'plan' | 'apply',
  input: SetupAgentInput,
): Promise<SetupAgentRequest> {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new SetupError('That agent no longer exists.');
  const device = getDevice(deviceId);
  if (!device || device.status !== 'active') throw new SetupError('That device is no longer connected to this home.');
  const host = getHome()?.hostDeviceId ?? null;
  // The agent's folder on the home, which a copy and its linked folders follow.
  const homeSetup = host && host !== deviceId ? getWorkspaceSetup(ws.id, host) : null;
  const homeFolder = homeSetup?.sourcePath ?? (ws.isGit && deviceId !== host ? ws.cwd : null);
  const remote = homeFolder ? await remoteUrl(homeFolder, ws.remoteName || 'origin') : null;
  // Where that device already has a linked folder, for its other agents:
  // one copy of a shared library per device, not one beside each agent.
  const known = new Map<string, string>();
  for (const setup of listWorkspaceSetups({ deviceId })) {
    if (setup.workspaceId === ws.id) continue;
    for (const r of setup.references) if (r.path && r.form === 'path' && !known.has(r.alias)) known.set(r.alias, r.path);
  }
  const references: SetupRequestReference[] = [];
  for (const ref of listReferenceFoldersForWorkspace(ws.id)) {
    const entry: SetupRequestReference = {
      alias: ref.alias,
      description: ref.description ?? null,
      relativePath: null,
      remote: null,
      knownPath: getFolderLink(deviceId, ref.id)?.path ?? known.get(ref.alias) ?? null,
      agentId: ref.targetWorkspaceId ?? null,
      omitted: false,
    };
    if (!ref.targetWorkspaceId && host && homeFolder) {
      const atHome = getFolderLink(host, ref.id);
      if (atHome && atHome.path === null) entry.omitted = true;
      else if (atHome?.path) {
        entry.relativePath = path.relative(homeFolder, atHome.path) || '.';
        entry.remote = await remoteUrl(atHome.path, 'origin');
      }
    }
    references.push(entry);
  }
  return {
    op,
    homeId: getHome()?.id ?? '',
    agentId: ws.id,
    agentName: ws.name,
    agentSlug: ws.slug,
    remote,
    how: input.how,
    folder: input.folder ?? null,
    references,
    existingFolder: getWorkspaceSetup(ws.id, deviceId)?.sourcePath ?? null,
    answers: input.answers,
  };
}

async function remoteUrl(folder: string, name: string): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', folder, 'remote', 'get-url', name], { timeout: 10_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
