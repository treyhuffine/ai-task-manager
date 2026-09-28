/**
 * The home's side of setting an agent up on a computer from the app
 * (docs/homes-model.md): what the computer needs to know, which only the
 * home has, and running it there. The home's own computer runs it
 * in-process. A connected computer runs it through its worker, and the home
 * records what it reports, as it would from `ri setup attach` there.
 *
 * What a copy comes from: the Git remote of the agent's folder on the home.
 * Where its references go: beside it, where they are on the home, copied
 * from their own remotes when they aren't there already.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { getAgentSetup, getComputer, getHome, getWorkspace, listAgentSetups, recordAgentSetupReports } from '@/lib/db/queries';
import { requestWorker, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import { buildSetupContext, inProcessSetupLink } from './home-context';
import {
  applySetupHere,
  planSetupHere,
  type SetupAgentRequest,
  type SetupPlanHere,
  type SetupRequestReference,
  type SetupResultHere,
} from './set-up-here';
import { SetupError } from './service';

const run = promisify(execFile);

/** Copying can take minutes. Asking where it would go takes a moment. */
const APPLY_TIMEOUT_MS = 11 * 60_000;

export interface SetupAgentInput {
  how: 'copy' | 'existing';
  /** A folder on that computer. Null: the default place, for a copy. */
  folder?: string | null;
  /** Folders for references that couldn't be found, or null to go without. */
  answers?: Record<string, string | null>;
}

/** What setting it up there would do, for the dialog to say before it does it. */
export interface SetupAgentPlan extends SetupPlanHere {
  agentName: string;
  computerName: string;
  /** Where a copy comes from. Null: only a folder already there can be used. */
  remote: string | null;
  /** The references it expects, and whether a copy brings each along. */
  references: { alias: string; description: string | null; comesAlong: boolean }[];
}

/** What setting it up answers: its setup there now, and where the agent can run. */
export interface SetupOutcome {
  folder: string;
  status: string;
  problem: string | null;
  /** References still unset, for the person to answer. */
  missing: { alias: string; description: string | null }[];
  copied: string[];
  runOn: import('./run-on').RunOn | null;
}

export class SetupUnavailableError extends Error {}

export async function planSetup(workspaceId: string, computerId: string): Promise<SetupAgentPlan> {
  const request = await requestFor(workspaceId, computerId, 'plan', { how: 'copy' });
  const here = (await runOn(computerId, request, 15_000)) as SetupPlanHere;
  return {
    ...here,
    agentName: request.agentName,
    computerName: request.context.computerName,
    remote: request.remote,
    references: request.references.map((r) => ({
      alias: r.alias,
      description: r.description,
      comesAlong: r.omitted || !!r.agentId || !!r.knownPath || (!!r.relativePath && !!r.remote),
    })),
  };
}

export async function applySetup(workspaceId: string, computerId: string, input: SetupAgentInput): Promise<SetupResultHere> {
  const request = await requestFor(workspaceId, computerId, 'apply', input);
  const result = (await runOn(computerId, request, APPLY_TIMEOUT_MS)) as SetupResultHere;
  // A computer elsewhere hands back what it now has: recorded as its report.
  if (computerId !== getHome()?.hostComputerId) recordAgentSetupReports(computerId, result.reports, { complete: true });
  return result;
}

async function runOn(computerId: string, request: SetupAgentRequest, timeoutMs: number): Promise<unknown> {
  if (computerId === getHome()?.hostComputerId) {
    return request.op === 'plan' ? planSetupHere(request) : applySetupHere(request, inProcessSetupLink());
  }
  const name = request.context.computerName;
  let answer: { status: number; body: unknown };
  try {
    answer = (await requestWorker(computerId, 'setup_agent', request, timeoutMs)) as { status: number; body: unknown };
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
  computerId: string,
  op: 'plan' | 'apply',
  input: SetupAgentInput,
): Promise<SetupAgentRequest> {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new SetupError('That agent no longer exists.');
  const computer = getComputer(computerId);
  if (!computer || computer.status !== 'active') throw new SetupError('That computer is no longer connected to this home.');
  const context = buildSetupContext(computer);
  const host = getHome()?.hostComputerId ?? null;
  // The agent's folder on the home, which a copy and its references follow.
  const homeSetup = host ? getAgentSetup(ws.id, host) : null;
  const homeFolder = homeSetup?.sourcePath ?? (ws.isGit && computerId !== host ? ws.cwd : null);
  const remote = homeFolder ? await remoteUrl(homeFolder, ws.remoteName || 'origin') : null;
  const homeRefs = new Map((homeSetup?.references ?? []).map((r) => [r.alias, r]));
  // Where that computer already has a reference, for its other agents: one
  // copy of a shared library per computer, not one beside each agent.
  const known = new Map<string, string>();
  for (const setup of listAgentSetups({ computerId })) {
    if (setup.workspaceId === ws.id) continue;
    for (const r of setup.references) if (r.exists && r.path && !known.has(r.alias)) known.set(r.alias, r.path);
  }
  const references: SetupRequestReference[] = [];
  for (const expected of context.expected[ws.id] ?? []) {
    const atHome = homeRefs.get(expected.alias);
    const value = atHome?.value;
    const ref: SetupRequestReference = {
      alias: expected.alias,
      description: expected.description,
      relativePath: null,
      remote: null,
      knownPath: known.get(expected.alias) ?? null,
      agentId: null,
      omitted: false,
    };
    if (value === null) ref.omitted = true;
    else if (value && typeof value === 'object') ref.agentId = value.agentId;
    else if (typeof value === 'string' && homeFolder) {
      const absolute = path.resolve(homeFolder, value);
      ref.relativePath = path.relative(homeFolder, absolute) || '.';
      ref.remote = await remoteUrl(absolute, 'origin');
    }
    references.push(ref);
  }
  return {
    op,
    context,
    agentId: ws.id,
    agentName: ws.name,
    agentSlug: ws.slug,
    remote,
    how: input.how,
    folder: input.folder ?? null,
    references,
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
