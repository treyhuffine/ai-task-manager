/**
 * The home's side of setups: what a computer needs to resolve its setup
 * files (docs/homes-spec.md §4.2), and the link the home's own computer uses
 * to set up folders in-process.
 */

import path from 'node:path';
import {
  expectedReferenceAliases,
  getHome,
  listAgentSetups,
  listReferenceFoldersForWorkspace,
  listWorkspaces,
  recordAgentSetupReports,
} from '@/lib/db/queries';
import type { ComputerRecord } from '@/db/types';
import { ensureHomeIdentity } from '@/lib/home/identity';
import {
  applyAdoption,
  planAdoption,
  referenceValue,
  type AdoptionPlan,
  type AdoptionReference,
  type AdoptionResult,
} from './adopt';
import { readSetupFile, writeSetupFile, type ReferenceValue } from './local-file';
import type { SetupReport } from './resolve';
import { attach, detach, syncSetups, type SetupContext, type SetupHomeLink } from './service';

export function buildSetupContext(computer: ComputerRecord): SetupContext {
  const home = getHome();
  if (!home) throw new Error('This database has no home yet.');
  return {
    homeId: home.id,
    homeName: home.name,
    computerId: computer.id,
    computerName: computer.name,
    agents: listWorkspaces({ status: 'active' }).map((w) => ({ id: w.id, name: w.name, status: w.status })),
    expected: expectedReferenceAliases(),
    observed: listAgentSetups({ computerId: computer.id }).map((s) => ({
      agentId: s.workspaceId,
      sourcePath: s.sourcePath,
      references: s.references.map((r) => ({ alias: r.alias, value: r.value })),
    })),
  };
}

/** Setups on the home's own computer, straight against the database. */
export function inProcessSetupLink(): SetupHomeLink {
  return {
    async context() {
      return buildSetupContext(ensureHomeIdentity().computer);
    },
    async report(reports, complete) {
      return recordAgentSetupReports(ensureHomeIdentity().computer.id, reports, { complete });
    },
  };
}

// ─── The home computer's folders (P1.5) ──────────────────────

/** The references an agent's folder maps by default on the home: its stored paths. */
function homeReferenceDefaults(agentId: string): AdoptionReference[] {
  return listReferenceFoldersForWorkspace(agentId).map((r) => ({
    alias: r.alias,
    path: r.path,
    targetWorkspaceId: r.targetWorkspaceId,
  }));
}

/** What adopting the home computer's existing folders would write. Reads only. */
export function planHomeAdoption(): AdoptionPlan {
  const { home, computer } = ensureHomeIdentity();
  const alreadySetUp = new Set(listAgentSetups({ computerId: computer.id }).map((s) => s.workspaceId));
  return planAdoption({
    homeId: home.id,
    agents: listWorkspaces({ status: 'active' }).map((w) => ({ id: w.id, name: w.name, cwd: w.cwd })),
    referencesFor: homeReferenceDefaults,
    alreadySetUp,
  });
}

export async function adoptHomeSetups(plan: AdoptionPlan): Promise<{ result: AdoptionResult; reports: SetupReport[] }> {
  const result = applyAdoption(plan);
  const reports = await syncSetups(inProcessSetupLink());
  return { result, reports };
}

/**
 * Set up an agent's folder on the home's own computer, as the person chose
 * it in the app: write the setup file with the agent's stored reference
 * paths, register it, and report. Replaces a different folder the agent had
 * here, which is how changing an agent's folder works. A failure is
 * reported, not thrown: the agent still exists, and its setup shows what
 * went wrong.
 */
export async function setHomeFolder(agentId: string, folder: string): Promise<SetupReport | null> {
  const link = inProcessSetupLink();
  const dir = path.resolve(folder);
  try {
    const ctx = await link.context();
    const current = ctx.observed.find((o) => o.agentId === agentId);
    if (current && path.resolve(current.sourcePath) !== dir) await detach(link, { agent: agentId });
    const references: Record<string, ReferenceValue> = {};
    for (const ref of homeReferenceDefaults(agentId)) {
      const value = referenceValue(ref);
      if (value !== null) references[ref.alias] = value;
    }
    return await attach(link, { agent: agentId, folder: dir, references });
  } catch (err) {
    console.warn(`[setups] could not set up ${dir} for agent ${agentId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export interface ReferenceChange {
  id: string;
  alias: string;
  workspaceId: string | null;
  path: string | null;
  targetWorkspaceId: string | null;
}

/**
 * A reference was added or changed on the home: carry it into the home
 * computer's setup files (docs/homes-spec.md §4.2). An agent that doesn't
 * map the alias yet gets the new value. One that still maps the previous
 * value follows the change. One mapped differently on this computer keeps
 * its own choice. An agent whose own reference shadows a global one of the
 * same name is left alone, as it is in sessions. Each file is written
 * against the revision it was read at, and failures are returned.
 */
export async function applyReferenceToHomeSetups(
  ref: ReferenceChange,
  before?: Pick<ReferenceChange, 'alias' | 'path' | 'targetWorkspaceId'> | null,
): Promise<{ updated: string[]; failed: { dir: string; error: string }[] }> {
  const link = inProcessSetupLink();
  const ctx = await link.context();
  const next = referenceValue(ref);
  const previous = before && before.alias === ref.alias ? referenceValue(before) : undefined;
  const byDir = new Map<string, string[]>();
  for (const seen of ctx.observed) {
    if (ref.workspaceId && seen.agentId !== ref.workspaceId) continue;
    const effective = listReferenceFoldersForWorkspace(seen.agentId).find((r) => r.alias === ref.alias);
    if (effective?.id !== ref.id) continue;
    const dir = path.resolve(seen.sourcePath);
    byDir.set(dir, [...(byDir.get(dir) ?? []), seen.agentId]);
  }

  const updated: string[] = [];
  const failed: { dir: string; error: string }[] = [];
  for (const [dir, agentIds] of byDir) {
    try {
      const current = readSetupFile(dir);
      if (current.state !== 'ok') continue;
      let changed = false;
      const agents = { ...current.file.agents };
      for (const id of agentIds) {
        const entry = agents[id];
        if (!entry) continue;
        const mapped = entry.references[ref.alias];
        const follows = mapped === undefined || (previous !== undefined && JSON.stringify(mapped) === JSON.stringify(previous));
        if (!follows || JSON.stringify(mapped) === JSON.stringify(next)) continue;
        const references = { ...entry.references };
        if (next === null) delete references[ref.alias];
        else references[ref.alias] = next;
        agents[id] = { references };
        changed = true;
      }
      if (!changed) continue;
      writeSetupFile(dir, { ...current.file, agents }, current.revision);
      updated.push(dir);
    } catch (err) {
      failed.push({ dir, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await syncSetups(link, ctx);
  return { updated, failed };
}
