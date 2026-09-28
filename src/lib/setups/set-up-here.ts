/**
 * Setting an agent up on this computer from the app (docs/homes-model.md,
 * spec §3.4: "When the project is not set up, offer Use existing folder and
 * Clone repository"). The project is copied down from its Git remote, or a
 * folder already here is used, and the references it expects are found in
 * the same place beside it as on the home, copied down too when they aren't.
 * The result is the same setup `ri setup attach` makes (`attach`).
 *
 * Runs where the folder is: on a connected computer through its worker
 * (`setup_agent`), on the home in-process. What only the home knows (the
 * agent, its remote, where its references sit beside it there) comes in the
 * request. Nothing here reads the home's database.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getAppRoot } from '@/lib/config/paths';
import { readSetupFile, type ReferenceValue } from './local-file';
import type { SetupReport } from './resolve';
import { attach, SetupError, setReference, syncSetups, type SetupContext, type SetupHomeLink } from './service';

const run = promisify(execFile);

/** Copying a project can take a while on a slow connection. */
const CLONE_TIMEOUT_MS = 10 * 60_000;

export interface SetupRequestReference {
  alias: string;
  description: string | null;
  /** Where it sits relative to the project on the home ("../code/agentex"), when it's a folder there. */
  relativePath: string | null;
  /** Its Git remote on the home, to copy it from when it isn't here. */
  remote: string | null;
  /**
   * Where it already is on this computer, for another agent that uses it:
   * used as it is, rather than a second copy beside this one.
   */
  knownPath: string | null;
  /** It's another agent, set up on its own. */
  agentId: string | null;
  /** The home goes without it, so this computer does too. */
  omitted: boolean;
}

export interface SetupAgentRequest {
  op: 'plan' | 'apply';
  context: SetupContext;
  agentId: string;
  agentName: string;
  agentSlug: string;
  /** Its Git remote on the home: where a copy comes from. Null when the home has none. */
  remote: string | null;
  /** `copy`: clone into `folder`, or the default place. `existing`: use `folder` as it is. */
  how: 'copy' | 'existing';
  folder: string | null;
  references: SetupRequestReference[];
  /** The person's answers for references that couldn't be found: a folder here, or null to go without. */
  answers?: Record<string, string | null>;
}

export interface SetupPlanHere {
  /** Where a copy goes when no folder is chosen. */
  defaultFolder: string;
  /** The agent's setup here already, if it has one. */
  existing: { folder: string; status: string; problem: string | null } | null;
}

export interface SetupResultHere {
  folder: string;
  /** This agent's setup here, as resolved. */
  report: SetupReport;
  /** Every setup on this computer, for the home's index. */
  reports: SetupReport[];
  /** References still unset, for the person to answer: a folder here, or go without. */
  missing: { alias: string; description: string | null }[];
  /** What was copied down, by folder. */
  copied: string[];
}

/** Where a copy of an agent goes by default: Ri's own projects folder on this computer. */
export function defaultProjectFolder(agentSlug: string): string {
  return path.join(getAppRoot(), 'projects', agentSlug);
}

export function planSetupHere(request: SetupAgentRequest): SetupPlanHere {
  const seen = request.context.observed.find((o) => o.agentId === request.agentId);
  let existing: SetupPlanHere['existing'] = null;
  if (seen) {
    const read = readSetupFile(seen.sourcePath);
    const has = read.state === 'ok' && !!read.file.agents[request.agentId];
    existing = { folder: seen.sourcePath, status: has ? 'set up' : 'missing', problem: has ? null : `${seen.sourcePath} no longer has its setup.` };
  }
  return { defaultFolder: defaultProjectFolder(request.agentSlug), existing };
}

/**
 * Set the agent up here, through `link` (the home in-process, or a link that
 * hands the reports back to the home with the answer). Anything this copied
 * down is removed again if the setup fails, so a failure leaves the
 * computer as it was.
 */
export async function applySetupHere(request: SetupAgentRequest, link: SetupHomeLink): Promise<SetupResultHere> {
  const seen = request.context.observed.find((o) => o.agentId === request.agentId);
  const setUp = seen ? readSetupFile(seen.sourcePath) : null;
  // Already here: only the answers for its references are left to write.
  if (seen && setUp?.state === 'ok' && setUp.file.agents[request.agentId]) {
    let report: SetupReport | null = null;
    for (const [alias, answer] of Object.entries(request.answers ?? {})) {
      report = await setReference(link, { agent: request.agentId, alias, value: answer === null ? null : localPath(answer) });
    }
    return finish(request, link, seen.sourcePath, report, []);
  }

  const created: string[] = [];
  const copied: string[] = [];
  try {
    const folder = await projectFolder(request, created, copied);
    const references: Record<string, ReferenceValue> = {};
    for (const ref of request.references) {
      const answer = request.answers?.[ref.alias];
      if (answer !== undefined) {
        references[ref.alias] = answer === null ? null : localPath(answer);
      } else if (ref.omitted) {
        references[ref.alias] = null;
      } else if (ref.agentId) {
        references[ref.alias] = { agentId: ref.agentId };
      } else if (ref.knownPath && fs.existsSync(ref.knownPath)) {
        references[ref.alias] = ref.knownPath;
      } else if (ref.relativePath) {
        const target = path.resolve(folder, ref.relativePath);
        if (fs.existsSync(target)) {
          references[ref.alias] = ref.relativePath;
        } else if (ref.remote) {
          await copyDown(ref.remote, target, created);
          copied.push(target);
          references[ref.alias] = ref.relativePath;
        }
      }
    }
    const report = await attach(link, { agent: request.agentId, folder, references });
    return finish(request, link, folder, report, copied);
  } catch (err) {
    for (const dir of created.reverse()) fs.rmSync(dir, { recursive: true, force: true });
    throw err instanceof SetupError ? err : new SetupError(err instanceof Error ? err.message : String(err));
  }
}

async function finish(
  request: SetupAgentRequest,
  link: SetupHomeLink,
  folder: string,
  report: SetupReport | null,
  copied: string[],
): Promise<SetupResultHere> {
  const reports = (link as Partial<CollectingLink>).collected?.() ?? (report ? [] : await syncSetups(link));
  const mine = report ?? reports.find((r) => r.agentId === request.agentId) ?? null;
  if (!mine) throw new SetupError(`${request.agentName} wasn't set up in ${folder}.`);
  const missing = mine.references
    .filter((r) => r.value === undefined)
    .map((r) => ({ alias: r.alias, description: request.references.find((x) => x.alias === r.alias)?.description ?? null }));
  return { folder, report: mine, reports, missing, copied };
}

/** The project's folder here: copied down into place, or one that's already here. */
async function projectFolder(request: SetupAgentRequest, created: string[], copied: string[]): Promise<string> {
  if (request.how === 'existing') {
    if (!request.folder) throw new SetupError('Choose the folder it is in.');
    return localPath(request.folder);
  }
  if (!request.remote) throw new SetupError(`${request.agentName} has no Git remote to copy it from. Choose a folder it's already in.`);
  const target = request.folder ? localPath(request.folder) : defaultProjectFolder(request.agentSlug);
  if (fs.existsSync(target)) {
    // A copy of it already there is used as it is.
    if (await isCopyOf(target, request.remote)) return target;
    if (fs.readdirSync(target).length > 0) {
      throw new SetupError(`${target} already has something else in it. Choose another folder, or use it as a folder it's already in.`);
    }
  }
  await copyDown(request.remote, target, created);
  copied.push(target);
  return target;
}

/** `git clone`, never asking for a password: this runs with nobody at the terminal. */
async function copyDown(remote: string, target: string, created: string[]): Promise<void> {
  const parent = path.dirname(target);
  const existed = fs.existsSync(target);
  fs.mkdirSync(parent, { recursive: true });
  try {
    await run('git', ['clone', '--quiet', remote, target], {
      timeout: CLONE_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    if (!existed) fs.rmSync(target, { recursive: true, force: true });
    throw new SetupError(`Couldn't copy ${remote}: ${stderr || (err instanceof Error ? err.message : String(err))}`);
  }
  if (!existed) created.push(target);
}

async function isCopyOf(folder: string, remote: string): Promise<boolean> {
  try {
    const { stdout } = await run('git', ['-C', folder, 'remote', 'get-url', 'origin'], { timeout: 10_000 });
    return sameRemote(stdout.trim(), remote);
  } catch {
    return false;
  }
}

/** Two spellings of one remote: `git@host:owner/repo.git` and `https://host/owner/repo` are the same. */
export function sameRemote(a: string, b: string): boolean {
  const norm = (url: string) => {
    let s = url.trim();
    const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(s);
    if (scp) s = `${scp[1]}/${scp[2]}`;
    else s = s.replace(/^[a-z+]+:\/\/(?:[^@/]+@)?/i, '');
    return s.replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
  };
  return norm(a) === norm(b);
}

/**
 * A link for a computer elsewhere: the home's context comes in the request,
 * and the reports go back with the answer, for the home to record.
 */
export interface CollectingLink extends SetupHomeLink {
  collected(): SetupReport[] | null;
}

export function collectingLink(context: SetupContext): CollectingLink {
  let last: SetupReport[] | null = null;
  return {
    async context() {
      return context;
    },
    async report(reports) {
      last = reports;
      return { stored: reports.length, removed: 0, ignored: [] };
    },
    collected() {
      return last;
    },
  };
}

/** A folder as the person typed it, on this computer: `~` is their home folder. */
function localPath(typed: string): string {
  const t = typed.trim();
  if (t === '~') return os.homedir();
  if (t.startsWith('~/')) return path.join(os.homedir(), t.slice(2));
  return path.resolve(t);
}
