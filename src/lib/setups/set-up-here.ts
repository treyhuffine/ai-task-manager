/**
 * Setting an agent up on this device from the app (docs/homes-model.md,
 * spec §3.4: "offer Use existing folder and Clone repository"): the project
 * copied down from its Git remote, or a folder already here, and the linked
 * folders it uses found in the same place beside it as on the home, or where
 * another agent here already has them, copied down too when they aren't.
 *
 * This only puts folders in place and says where they are. The home records
 * them (docs/homes-spec.md §4.1): nothing about the agent is written here.
 * Runs where the folders are: on a connected device through its worker
 * (`setup_agent`), on the home in-process. No database.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getAppRoot } from '@/lib/config/paths';

const run = promisify(execFile);

/** Copying a project can take a while on a slow connection. */
const CLONE_TIMEOUT_MS = 10 * 60_000;

export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}

export interface SetupRequestReference {
  alias: string;
  description: string | null;
  /** Where it sits relative to the project on the home ("../code/agentex"), when it's a folder there. */
  relativePath: string | null;
  /** Its Git remote on the home, to copy it from when it isn't here. */
  remote: string | null;
  /** Where it already is on this device, for another agent that uses it: used as it is. */
  knownPath: string | null;
  /** It's another agent: its own project folder, set up on its own. */
  agentId: string | null;
  /** The home goes without it, so this device does too. */
  omitted: boolean;
}

export interface SetupAgentRequest {
  op: 'plan' | 'apply';
  homeId: string;
  agentId: string;
  agentName: string;
  agentSlug: string;
  /** Its Git remote on the home: where a copy comes from. Null when the home has none. */
  remote: string | null;
  /** `copy`: clone into `folder`, or the default place. `existing`: use `folder` as it is. */
  how: 'copy' | 'existing';
  folder: string | null;
  references: SetupRequestReference[];
  /** Its project folder here, as the home records it, if it has one. */
  existingFolder: string | null;
  /** The person's answers for linked folders that couldn't be found: a folder here, or null to go without. */
  answers?: Record<string, string | null>;
}

export interface SetupPlanHere {
  /** Where a copy goes when no folder is chosen. */
  defaultFolder: string;
  /** Its project folder here as the home records it, and whether it's there. */
  existing: { folder: string; found: boolean } | null;
}

export interface SetupResultHere {
  folder: string;
  /**
   * Where each linked folder is here: a path, null for going without it, or
   * absent when it couldn't be found or copied, for the person to choose.
   */
  links: Record<string, string | null>;
  /** What was copied down, by folder. */
  copied: string[];
}

/** Where a copy of an agent goes by default: Ri's own projects folder on this device. */
export function defaultProjectFolder(agentSlug: string): string {
  return path.join(getAppRoot(), 'projects', agentSlug);
}

export function planSetupHere(request: SetupAgentRequest): SetupPlanHere {
  return {
    defaultFolder: defaultProjectFolder(request.agentSlug),
    existing: request.existingFolder ? { folder: request.existingFolder, found: isDirectory(request.existingFolder) } : null,
  };
}

/**
 * Put the agent's folders in place here and say where they are. Anything
 * this copied down is removed again if a later step fails, so a failure
 * leaves the device as it was.
 */
export async function applySetupHere(request: SetupAgentRequest): Promise<SetupResultHere> {
  const created: string[] = [];
  const copied: string[] = [];
  try {
    const folder = await projectFolder(request, created, copied);
    const links: Record<string, string | null> = {};
    for (const ref of request.references) {
      if (ref.agentId) continue;
      const answer = request.answers?.[ref.alias];
      if (answer !== undefined) {
        if (answer === null) {
          links[ref.alias] = null;
          continue;
        }
        const chosen = localPath(answer);
        if (!isDirectory(chosen)) throw new SetupError(`${chosen} doesn't exist or isn't a folder.`);
        links[ref.alias] = chosen;
      } else if (ref.omitted) {
        links[ref.alias] = null;
      } else if (ref.knownPath && isDirectory(ref.knownPath)) {
        links[ref.alias] = ref.knownPath;
      } else if (ref.relativePath) {
        const target = path.resolve(folder, ref.relativePath);
        if (isDirectory(target)) {
          links[ref.alias] = target;
        } else if (ref.remote) {
          await copyDown(ref.remote, target, created);
          copied.push(target);
          links[ref.alias] = target;
        }
      }
    }
    return { folder, links, copied };
  } catch (err) {
    for (const dir of created.reverse()) fs.rmSync(dir, { recursive: true, force: true });
    throw err instanceof SetupError ? err : new SetupError(err instanceof Error ? err.message : String(err));
  }
}

/** The project's folder here: copied down into place, or one that's already here. */
async function projectFolder(request: SetupAgentRequest, created: string[], copied: string[]): Promise<string> {
  if (request.how === 'existing') {
    if (!request.folder) throw new SetupError('Choose the folder it is in.');
    const folder = localPath(request.folder);
    if (!isDirectory(folder)) throw new SetupError(`${folder} doesn't exist or isn't a folder.`);
    return folder;
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
  const existed = fs.existsSync(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
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

/** A folder as the person typed it, on this device: `~` is their home folder. */
export function localPath(typed: string): string {
  const t = typed.trim();
  if (t === '~') return os.homedir();
  if (t.startsWith('~/')) return path.join(os.homedir(), t.slice(2));
  return path.resolve(t);
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
