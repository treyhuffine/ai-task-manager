/**
 * Move the home computer's existing agent folders into setup files
 * (docs/homes-spec.md §10.1, P1.5).
 *
 * Before this build an agent's folder was `workspaces.cwd` and its reference
 * paths were in `reference_folders`, all in the database. Adoption writes the
 * same choices into a `.ri.local.json` in each agent's folder on the home's
 * own computer, registers it, and reports it. Nothing else changes: the same
 * folders, scripts, agents and ids. References keep their stored paths as
 * absolute paths, which stay local to this computer.
 *
 * `planAdoption` only reads: the folders, and any setup files already there.
 * It runs against the live database or, read-only, against a copy of another
 * home's database, so a cutover can be previewed without touching a folder.
 * `applyAdoption` writes the plan and never replaces a file it didn't plan to.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readSetupFile, writeSetupFile, type ReferenceValue, type SetupFile } from './local-file';
import { registerLocation } from './registry';

export interface AdoptionAgent {
  id: string;
  name: string;
  cwd: string;
}

export interface AdoptionReference {
  alias: string;
  path: string | null;
  targetWorkspaceId: string | null;
}

export type AdoptionStep =
  /** Write a new setup file holding these agents. */
  | { kind: 'create'; dir: string; agents: string[]; file: SetupFile }
  /** Add these agents to a setup file already there for this home. */
  | { kind: 'add'; dir: string; agents: string[]; file: SetupFile; baseRevision: string }
  /** The file already has these agents: only register it. */
  | { kind: 'register'; dir: string; agents: string[] }
  /** Can't adopt this folder. Its agents keep working from the database until it's fixed. */
  | { kind: 'skip'; dir: string; agents: string[]; reason: string };

export interface AdoptionPlan {
  homeId: string;
  steps: AdoptionStep[];
}

export function referenceValue(ref: AdoptionReference): ReferenceValue {
  if (ref.targetWorkspaceId) return { agentId: ref.targetWorkspaceId };
  return ref.path;
}

export function planAdoption(input: {
  homeId: string;
  agents: AdoptionAgent[];
  /** The references an agent expects: global plus its own, its own winning. */
  referencesFor: (agentId: string) => AdoptionReference[];
  /** Agents the home computer already reports. They are left alone. */
  alreadySetUp?: Set<string>;
}): AdoptionPlan {
  const byDir = new Map<string, AdoptionAgent[]>();
  for (const agent of input.agents) {
    if (input.alreadySetUp?.has(agent.id)) continue;
    const dir = path.resolve(agent.cwd);
    byDir.set(dir, [...(byDir.get(dir) ?? []), agent]);
  }

  const steps: AdoptionStep[] = [];
  for (const [dir, agents] of byDir) {
    const ids = agents.map((a) => a.id);
    let isDir = false;
    try {
      isDir = fs.statSync(dir).isDirectory();
    } catch {
      /* missing */
    }
    if (!isDir) {
      steps.push({ kind: 'skip', dir, agents: ids, reason: `${dir} doesn't exist on this computer.` });
      continue;
    }
    const entries: SetupFile['agents'] = {};
    for (const agent of agents) {
      const references: Record<string, ReferenceValue> = {};
      for (const ref of input.referencesFor(agent.id)) {
        const value = referenceValue(ref);
        if (value !== null) references[ref.alias] = value;
      }
      entries[agent.id] = { references };
    }
    const current = readSetupFile(dir);
    if (current.state === 'missing') {
      steps.push({ kind: 'create', dir, agents: ids, file: { version: 1, homeId: input.homeId, agents: entries } });
    } else if (current.state === 'invalid') {
      steps.push({ kind: 'skip', dir, agents: ids, reason: current.problem });
    } else if (current.file.homeId !== input.homeId) {
      steps.push({ kind: 'skip', dir, agents: ids, reason: `${dir} is already set up for a different Ri home.` });
    } else {
      const missing = ids.filter((id) => !current.file.agents[id]);
      if (missing.length === 0) {
        steps.push({ kind: 'register', dir, agents: ids });
      } else {
        const agentsNext = { ...current.file.agents };
        for (const id of missing) agentsNext[id] = entries[id]!;
        steps.push({
          kind: 'add',
          dir,
          agents: missing,
          file: { ...current.file, agents: agentsNext },
          baseRevision: current.revision,
        });
      }
    }
  }
  return { homeId: input.homeId, steps: steps.sort((a, b) => a.dir.localeCompare(b.dir)) };
}

export interface AdoptionResult {
  written: string[];
  registered: string[];
  skipped: { dir: string; reason: string }[];
}

/** Write the plan's files and register every adopted folder. */
export function applyAdoption(plan: AdoptionPlan): AdoptionResult {
  const result: AdoptionResult = { written: [], registered: [], skipped: [] };
  for (const step of plan.steps) {
    if (step.kind === 'skip') {
      result.skipped.push({ dir: step.dir, reason: step.reason });
      continue;
    }
    if (step.kind === 'create') writeSetupFile(step.dir, step.file, null);
    if (step.kind === 'add') writeSetupFile(step.dir, step.file, step.baseRevision);
    if (step.kind !== 'register') result.written.push(step.dir);
    registerLocation(step.dir);
    result.registered.push(step.dir);
  }
  return result;
}
