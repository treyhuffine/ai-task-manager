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
import { listRegisteredLocations, moveLocation, registerLocation, unregisterLocation } from './registry';
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

export function findAgent(ctx: SetupContext, idOrName: string): SetupAgentSummary {
  const byId = ctx.agents.find((a) => a.id === idOrName);
  if (byId) return byId;
  const byName = ctx.agents.filter((a) => a.name.toLowerCase() === idOrName.toLowerCase());
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) throw new SetupError(`More than one agent is named "${idOrName}". Use its id.`);
  throw new SetupError(`${ctx.homeName} has no agent "${idOrName}".`);
}

/** Resolve every registered setup on this computer and report them all. */
export async function syncSetups(link: SetupHomeLink, ctx?: SetupContext): Promise<SetupReport[]> {
  const context = ctx ?? (await link.context());
  const reports = resolveSetups({
    homeId: context.homeId,
    registered: listRegisteredLocations().map((l) => l.dir),
    expected: Object.fromEntries(Object.entries(context.expected).map(([id, refs]) => [id, refs.map((r) => ({ alias: r.alias }))])),
    lastSeen: Object.fromEntries(context.observed.map((o) => [o.agentId, o.sourcePath])),
  });
  await link.report(reports, true);
  return reports;
}

export interface AttachOptions {
  agent: string;
  folder: string;
  /** Initial reference mappings. Aliases not given stay unset, which blocks until chosen. */
  references?: Record<string, ReferenceValue>;
}

export async function attach(link: SetupHomeLink, opts: AttachOptions): Promise<SetupReport> {
  const ctx = await link.context();
  const agent = findAgent(ctx, opts.agent);
  const dir = path.resolve(opts.folder);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new SetupError(`${dir} is not a folder.`);

  const elsewhere = ctx.observed.find((o) => o.agentId === agent.id && path.resolve(o.sourcePath) !== dir);
  if (elsewhere && fs.existsSync(elsewhere.sourcePath)) {
    throw new SetupError(
      `${agent.name} is already set up on ${ctx.computerName} at ${elsewhere.sourcePath}. ` +
        'An agent has one folder per computer: relink it, or detach it there first.',
    );
  }

  const unknown = Object.keys(opts.references ?? {}).filter(
    (alias) => !(ctx.expected[agent.id] ?? []).some((r) => r.alias === alias),
  );
  if (unknown.length) {
    throw new SetupError(`${agent.name} has no reference named ${unknown.map((a) => `"${a}"`).join(', ')}.`);
  }

  const current = readSetupFile(dir);
  if (current.state === 'invalid') throw new SetupError(`${current.problem} Fix it, or move it aside and attach again.`);
  if (current.state === 'ok' && current.file.homeId !== ctx.homeId) {
    throw new SetupError(`${path.join(dir, SETUP_FILE)} belongs to a different Ri home.`);
  }
  if (current.state === 'ok' && current.file.agents[agent.id]) {
    // Already in the file here: attaching again only (re)registers it.
    registerLocation(dir);
  } else {
    const next: SetupFile =
      current.state === 'ok'
        ? { ...current.file, agents: { ...current.file.agents, [agent.id]: { references: opts.references ?? {} } } }
        : { version: 1, homeId: ctx.homeId, agents: { [agent.id]: { references: opts.references ?? {} } } };
    writeSetupFile(dir, next, current.state === 'ok' ? current.revision : null);
    registerLocation(dir);
  }
  const reports = await syncSetups(link, ctx);
  return reports.find((r) => r.agentId === agent.id)!;
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
  const current = readSetupFile(dir);
  if (current.state !== 'ok' || !current.file.agents[agent.id]) {
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
  const current = readSetupFile(dir);
  if (current.state === 'ok' && current.file.agents[agent.id]) {
    const agents = { ...current.file.agents };
    delete agents[agent.id];
    if (Object.keys(agents).length === 0) {
      fs.rmSync(path.join(dir, SETUP_FILE));
      unregisterLocation(dir);
    } else {
      writeSetupFile(dir, { ...current.file, agents }, current.revision);
    }
  } else if (!listRegisteredLocations().some((l) => path.resolve(l.dir) === dir)) {
    throw new SetupError(`${agent.name} isn't set up on ${ctx.computerName}.`);
  } else {
    unregisterLocation(dir);
  }
  await syncSetups(link, ctx);
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
