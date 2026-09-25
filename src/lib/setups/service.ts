/**
 * Setting up agent folders on this computer (docs/homes-spec.md §4.2).
 *
 * The same operations run on the home's own computer and on a connected
 * computer. They read and write this computer's setup files and registry,
 * and talk to the home through a `SetupHomeLink`: in-process on the home,
 * over the home's API elsewhere. After every change the computer reports
 * all of its setups, so the home's observed index matches the files.
 *
 * - `attach`: set up a folder for an existing agent.
 * - `setReference`: map one reference alias, revision-checked.
 * - `relink`: point an agent at its folder's new location after a rename.
 * - `planRestore` / `restore`: rebuild a deleted setup file from the last
 *   report, after showing what will be written. Never over an existing file.
 * - `detach`: remove an agent's setup from this computer.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  readSetupFile,
  writeSetupFile,
  SETUP_FILE,
  type ReferenceValue,
  type SetupFile,
} from './local-file';
import { isRegistered, listRegisteredLocations, moveLocation, registerLocation, unregisterLocation } from './registry';
import { resolveSetups, type SetupReport } from './resolve';

export interface SetupAgentSummary {
  id: string;
  name: string;
  status: string;
}

export interface ObservedSetup {
  agentId: string;
  sourcePath: string;
  references: { alias: string; value?: ReferenceValue }[];
}

export interface SetupContext {
  homeId: string;
  homeName: string;
  computerId: string;
  computerName: string;
  agents: SetupAgentSummary[];
  /** Reference aliases each agent expects. */
  expected: Record<string, { alias: string; description: string | null }[]>;
  /** What the home last observed on this computer, by agent. */
  observed: ObservedSetup[];
}

export interface SetupHomeLink {
  context(): Promise<SetupContext>;
  report(reports: SetupReport[], complete: boolean): Promise<{ stored: number; removed: number; ignored: string[] }>;
}

export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}

/**
 * Read a setup file to change it: fresh from disk, and only if it belongs to
 * this home. A file for another home, or one that can't be read, is never
 * changed. Returns `null` when there is no file.
 */
function readOwned(dir: string, homeId: string): { revision: string; file: SetupFile } | null {
  const read = readSetupFile(dir);
  if (read.state === 'missing') return null;
  if (read.state === 'invalid') throw new SetupError(`${read.problem} Nothing was changed.`);
  if (read.file.homeId !== homeId) {
    throw new SetupError(`${path.join(dir, SETUP_FILE)} belongs to a different Ri home. Nothing was changed.`);
  }
  return { revision: read.revision, file: read.file };
}

/**
 * Whether `folder` can hold this home's setup for an agent: it exists, and
 * any setup file in it is readable and belongs to this home. Throws the
 * reason otherwise. Changes nothing, so callers check before they act.
 */
export function assertFolderCanHoldSetup(folder: string, homeId: string): string {
  const dir = path.resolve(folder);
  let isDir = false;
  try {
    isDir = fs.statSync(dir).isDirectory();
  } catch {
    /* missing */
  }
  if (!isDir) throw new SetupError(`${dir} doesn't exist or isn't a folder.`);
  readOwned(dir, homeId);
  return dir;
}

export function findAgent(ctx: SetupContext, idOrName: string): SetupAgentSummary {
  const byId = ctx.agents.find((a) => a.id === idOrName);
  if (byId) return byId;
  const byName = ctx.agents.filter((a) => a.name.toLowerCase() === idOrName.toLowerCase());
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) throw new SetupError(`More than one agent is named "${idOrName}". Use its id.`);
  throw new SetupError(`${ctx.homeName} has no agent "${idOrName}".`);
}

/**
 * Resolve every registered setup on this computer and report them all.
 * `forget` names agents deliberately removed here, so a folder they were last
 * seen in doesn't keep reporting them as broken.
 */
export async function syncSetups(
  link: SetupHomeLink,
  ctx?: SetupContext,
  opts: { forget?: Set<string> } = {},
): Promise<SetupReport[]> {
  const context = ctx ?? (await link.context());
  const resolved = resolveSetups({
    homeId: context.homeId,
    registered: listRegisteredLocations().map((l) => l.dir),
    expected: Object.fromEntries(Object.entries(context.expected).map(([id, refs]) => [id, refs.map((r) => ({ alias: r.alias }))])),
    lastSeen: Object.fromEntries(
      context.observed.filter((o) => !opts.forget?.has(o.agentId)).map((o) => [o.agentId, o.sourcePath]),
    ),
  });
  const reports = opts.forget ? resolved.filter((r) => !opts.forget!.has(r.agentId)) : resolved;
  await link.report(reports, true);
  return reports;
}

export interface AttachOptions {
  agent: string;
  folder: string;
  /** Initial reference mappings. Aliases not given stay unset, which blocks until chosen. */
  references?: Record<string, ReferenceValue>;
  /**
   * Move the agent here from a different folder it has on this computer. The
   * new folder is set up first, and the old one is only cleared after that
   * succeeds, so a failed move leaves the old setup as it was.
   */
  replace?: boolean;
}

export async function attach(link: SetupHomeLink, opts: AttachOptions): Promise<SetupReport> {
  const ctx = await link.context();
  const agent = findAgent(ctx, opts.agent);
  const dir = assertFolderCanHoldSetup(opts.folder, ctx.homeId);

  const unknown = Object.keys(opts.references ?? {}).filter(
    (alias) => !(ctx.expected[agent.id] ?? []).some((r) => r.alias === alias),
  );
  if (unknown.length) {
    throw new SetupError(`${agent.name} has no reference named ${unknown.map((a) => `"${a}"`).join(', ')}.`);
  }

  const previous = ctx.observed.find((o) => o.agentId === agent.id && path.resolve(o.sourcePath) !== dir);
  if (previous && fs.existsSync(previous.sourcePath) && !opts.replace) {
    throw new SetupError(
      `${agent.name} is already set up on ${ctx.computerName} at ${previous.sourcePath}. ` +
        'An agent has one folder per computer: relink it, or detach it there first.',
    );
  }

  // Before writing anything, make sure the old folder can be cleared too, so
  // a move doesn't end half done with the agent set up in both.
  const oldDir = previous ? path.resolve(previous.sourcePath) : null;
  if (oldDir) assertCanClearAgent(oldDir, agent.id, ctx);

  // The new folder first.
  const wasRegistered = isRegistered(dir);
  const current = readOwned(dir, ctx.homeId);
  let written: string | null = null;
  if (!current?.file.agents[agent.id]) {
    const next: SetupFile = current
      ? { ...current.file, agents: { ...current.file.agents, [agent.id]: { references: opts.references ?? {} } } }
      : { version: 1, homeId: ctx.homeId, agents: { [agent.id]: { references: opts.references ?? {} } } };
    written = writeSetupFile(dir, next, current?.revision ?? null);
  }
  registerLocation(dir);

  // Then clear the old one. If that still fails, put the new folder back as
  // it was, so the agent keeps exactly one setup here.
  if (oldDir) {
    try {
      removeAgentFrom(oldDir, agent.id, ctx);
    } catch (err) {
      undoAttach(dir, { written, previousFile: current?.file ?? null, wasRegistered });
      throw new SetupError(
        `Couldn't clear ${agent.name}'s setup in ${oldDir} (${err instanceof Error ? err.message : String(err)}). ` +
          'The new folder was put back as it was, so nothing changed.',
      );
    }
  }

  const reports = await syncSetups(link, ctx);
  return reports.find((r) => r.agentId === agent.id)!;
}

/**
 * Refuse, before anything is written, a move whose old folder can't be
 * cleared: its setup file can't be read, belongs to another home, or sits in
 * a folder this process can't write to.
 */
function assertCanClearAgent(dir: string, agentId: string, ctx: SetupContext): void {
  const read = readSetupFile(dir);
  if (read.state === 'missing') return;
  if (read.state === 'invalid') {
    throw new SetupError(`${read.problem} Fix or restore it before moving this agent. Nothing was changed.`);
  }
  if (read.file.homeId !== ctx.homeId || !read.file.agents[agentId]) return;
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    throw new SetupError(`${dir} can't be written to, so this agent's setup there can't be cleared. Nothing was changed.`);
  }
}

/**
 * Put a destination back the way `attach` found it, but only if it still
 * holds exactly what `attach` wrote. A file someone has changed since is left
 * alone. Restoring an earlier file is revision-checked by `writeSetupFile`.
 * Removing a file `attach` created checks the revision first, which leaves a
 * moment between check and delete: a hand edit landing exactly then would be
 * lost. That window is milliseconds on a failure path, and closing it would
 * need a lock every other writer honors.
 */
function undoAttach(
  dir: string,
  state: { written: string | null; previousFile: SetupFile | null; wasRegistered: boolean },
): void {
  try {
    if (state.written) {
      const now = readSetupFile(dir);
      if (now.state === 'ok' && now.revision === state.written) {
        if (state.previousFile) writeSetupFile(dir, state.previousFile, state.written);
        else fs.rmSync(path.join(dir, SETUP_FILE));
      }
    }
  } finally {
    if (!state.wasRegistered) unregisterLocation(dir);
  }
}

/**
 * Take an agent out of a folder's setup file. The file goes, and the folder
 * is unregistered, only when no other agent uses it. A folder whose file is
 * already gone or can't be read is left registered when other agents were
 * last seen there, so their setups can still be restored.
 */
function removeAgentFrom(dir: string, agentId: string, ctx: SetupContext): void {
  const read = readSetupFile(dir);
  if (read.state === 'ok') {
    if (read.file.homeId !== ctx.homeId) return;
    if (!read.file.agents[agentId]) return;
    const agents = { ...read.file.agents };
    delete agents[agentId];
    if (Object.keys(agents).length === 0) {
      fs.rmSync(path.join(dir, SETUP_FILE));
      unregisterLocation(dir);
    } else {
      writeSetupFile(dir, { ...read.file, agents }, read.revision);
    }
    return;
  }
  const others = ctx.observed.some((o) => o.agentId !== agentId && path.resolve(o.sourcePath) === dir);
  if (!others) unregisterLocation(dir);
}

/** Set one reference for an agent on this computer. `undefined` value removes the mapping. */
export async function setReference(
  link: SetupHomeLink,
  opts: { agent: string; alias: string; value: ReferenceValue | undefined; expectedRevision?: string },
): Promise<SetupReport> {
  const ctx = await link.context();
  const agent = findAgent(ctx, opts.agent);
  if (!(ctx.expected[agent.id] ?? []).some((r) => r.alias === opts.alias)) {
    throw new SetupError(`${agent.name} has no reference named "${opts.alias}".`);
  }
  const dir = folderOf(ctx, agent.id);
  const current = readOwned(dir, ctx.homeId);
  if (!current?.file.agents[agent.id]) {
    throw new SetupError(`${agent.name} isn't set up in ${dir}. Attach or restore it first.`);
  }
  const references = { ...current.file.agents[agent.id]!.references };
  if (opts.value === undefined) delete references[opts.alias];
  else references[opts.alias] = opts.value;
  const next = { ...current.file, agents: { ...current.file.agents, [agent.id]: { references } } };
  writeSetupFile(dir, next, opts.expectedRevision ?? current.revision);
  const reports = await syncSetups(link, ctx);
  return reports.find((r) => r.agentId === agent.id)!;
}

/**
 * The folder was renamed or moved: register its new location. The setup
 * file moved with it, so it must still name this home and agent. No disk
 * scanning: the person names the new location.
 */
export async function relink(link: SetupHomeLink, opts: { agent: string; folder: string }): Promise<SetupReport> {
  const ctx = await link.context();
  const agent = findAgent(ctx, opts.agent);
  const dir = path.resolve(opts.folder);
  const read = readSetupFile(dir);
  if (read.state !== 'ok' || read.file.homeId !== ctx.homeId || !read.file.agents[agent.id]) {
    throw new SetupError(
      `${dir} has no setup for ${agent.name}. Relink needs the folder that was renamed; for a different folder, attach it instead.`,
    );
  }
  const old = ctx.observed.find((o) => o.agentId === agent.id)?.sourcePath;
  if (old && path.resolve(old) !== dir) moveLocation(old, dir);
  else registerLocation(dir);
  const reports = await syncSetups(link, ctx);
  return reports.find((r) => r.agentId === agent.id)!;
}

export interface RestorePlan {
  dir: string;
  /** Agents the file will hold, from what the home last observed there. */
  agents: string[];
  file: SetupFile;
  /** An existing file that the plan adds to, rather than creating. */
  baseRevision: string | null;
}

/**
 * Work out what a deleted setup file held, from the home's last report, and
 * check it can be written back: the folder must exist, it must belong to
 * this computer and home, and nothing will be overwritten. Writes nothing.
 */
export async function planRestore(link: SetupHomeLink, opts: { agent: string }): Promise<RestorePlan> {
  const ctx = await link.context();
  const agent = findAgent(ctx, opts.agent);
  const seen = ctx.observed.find((o) => o.agentId === agent.id);
  if (!seen) throw new SetupError(`${ctx.homeName} has no earlier setup of ${agent.name} on ${ctx.computerName} to restore.`);
  const dir = path.resolve(seen.sourcePath);
  if (!fs.existsSync(dir)) {
    throw new SetupError(`${dir} no longer exists. If the folder moved, relink it instead.`);
  }
  const current = readSetupFile(dir);
  if (current.state === 'invalid') throw new SetupError(`${current.problem} Move it aside to restore.`);
  if (current.state === 'ok' && current.file.homeId !== ctx.homeId) {
    throw new SetupError(`${path.join(dir, SETUP_FILE)} belongs to a different Ri home. Nothing was changed.`);
  }
  const together = ctx.observed.filter((o) => path.resolve(o.sourcePath) === dir);
  const agents: SetupFile['agents'] = current.state === 'ok' ? { ...current.file.agents } : {};
  const restored: string[] = [];
  for (const o of together) {
    if (agents[o.agentId]) continue;
    const references: Record<string, ReferenceValue> = {};
    for (const r of o.references) if (r.value !== undefined) references[r.alias] = r.value;
    agents[o.agentId] = { references };
    restored.push(o.agentId);
  }
  if (restored.length === 0) throw new SetupError(`${agent.name}'s setup is already in ${path.join(dir, SETUP_FILE)}.`);
  return {
    dir,
    agents: restored,
    file: { version: 1, homeId: ctx.homeId, agents },
    baseRevision: current.state === 'ok' ? current.revision : null,
  };
}

/** Write a confirmed restore plan. Refuses if the file changed since the plan. */
export async function restore(link: SetupHomeLink, plan: RestorePlan): Promise<SetupReport[]> {
  writeSetupFile(plan.dir, plan.file, plan.baseRevision);
  registerLocation(plan.dir);
  const reports = await syncSetups(link);
  return reports.filter((r) => plan.agents.includes(r.agentId));
}

/** Remove an agent's setup from this computer. The folder itself is untouched. */
export async function detach(link: SetupHomeLink, opts: { agent: string }): Promise<void> {
  const ctx = await link.context();
  const agent = findAgent(ctx, opts.agent);
  const dir = folderOf(ctx, agent.id);
  const read = readSetupFile(dir);
  if (read.state === 'ok' && read.file.homeId !== ctx.homeId) {
    throw new SetupError(`${path.join(dir, SETUP_FILE)} belongs to a different Ri home. Nothing was changed.`);
  }
  removeAgentFrom(dir, agent.id, ctx);
  await syncSetups(link, ctx, { forget: new Set([agent.id]) });
}

function folderOf(ctx: SetupContext, agentId: string): string {
  const seen = ctx.observed.find((o) => o.agentId === agentId);
  if (seen) return path.resolve(seen.sourcePath);
  for (const loc of listRegisteredLocations()) {
    const read = readSetupFile(loc.dir);
    if (read.state === 'ok' && read.file.homeId === ctx.homeId && read.file.agents[agentId]) return path.resolve(loc.dir);
  }
  throw new SetupError(`This agent isn't set up on ${ctx.computerName}.`);
}
