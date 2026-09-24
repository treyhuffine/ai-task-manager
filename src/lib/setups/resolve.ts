/**
 * Resolve this computer's setups for a home into reports
 * (docs/homes-spec.md §4.1 to §4.3).
 *
 * Inputs are this computer's registered folders, the home's expected
 * reference aliases for each agent, and where each agent was last seen, so
 * a folder that went missing still reports against the agents that used it.
 * The output is one report per agent: its source folder, the file revision,
 * each reference resolved, and a status. Anything but `ready` blocks
 * starting work with that setup, and the problem says what to do.
 *
 * No database here. The home runs this for its own computer, and a worker
 * runs it for its own, and both send the same reports.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readSetupFile, SETUP_FILE, type ReferenceValue, type SetupFile } from './local-file';

export type SetupStatus =
  /** Everything resolves. */
  | 'ready'
  /** The source folder is gone, e.g. renamed or deleted. Relink it. */
  | 'missing_folder'
  /** The folder is there but its setup file isn't, e.g. after `git clean -fdx`. Restore it. */
  | 'missing_file'
  /** The setup file can't be read. Fix or restore it. */
  | 'invalid_config'
  /** The setup file belongs to a different home. */
  | 'wrong_home'
  /** A reference is unset, gone, or names an agent with no folder here. */
  | 'missing_reference'
  /** Two registered folders claim the same agent. Keep one. */
  | 'duplicate';

export type ReferenceForm = 'path' | 'agent' | 'omitted' | 'unconfigured';

export interface ReferenceReport {
  alias: string;
  /** The value exactly as the file has it. Absent when the file doesn't set it. */
  value?: ReferenceValue;
  form: ReferenceForm;
  /** Resolved absolute path on this computer, for `path` and `agent` forms. */
  path: string | null;
  exists: boolean;
  problem: string | null;
}

export interface SetupReport {
  agentId: string;
  sourcePath: string;
  configRevision: string | null;
  references: ReferenceReport[];
  status: SetupStatus;
  problem: string | null;
}

export interface ExpectedReference {
  alias: string;
}

export interface ResolveInput {
  homeId: string;
  /** Registered source folders on this computer. */
  registered: string[];
  /** The reference aliases the home defines for each agent (global and the agent's own). */
  expected: Record<string, ExpectedReference[]>;
  /** Where each agent's setup was last observed on this computer. */
  lastSeen?: Record<string, string>;
}

interface Located {
  dir: string;
  revision: string;
  file: SetupFile;
}

const RELINK = 'Choose its new location to relink it.';

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function resolveSetups(input: ResolveInput): SetupReport[] {
  const byAgent = new Map<string, Located[]>();
  const locationProblem = new Map<string, { status: SetupStatus; problem: string; revision: string | null }>();

  for (const dir of input.registered) {
    if (!isDir(dir)) {
      locationProblem.set(dir, { status: 'missing_folder', problem: `${dir} no longer exists. ${RELINK}`, revision: null });
      continue;
    }
    const read = readSetupFile(dir);
    if (read.state === 'missing') {
      locationProblem.set(dir, {
        status: 'missing_file',
        problem: `${path.join(dir, SETUP_FILE)} is gone. Restore it from the last known setup.`,
        revision: null,
      });
      continue;
    }
    if (read.state === 'invalid') {
      locationProblem.set(dir, { status: 'invalid_config', problem: read.problem, revision: read.revision });
      continue;
    }
    if (read.file.homeId !== input.homeId) {
      locationProblem.set(dir, {
        status: 'wrong_home',
        problem: `${path.join(dir, SETUP_FILE)} belongs to a different Ri home.`,
        revision: read.revision,
      });
      continue;
    }
    for (const agentId of Object.keys(read.file.agents)) {
      const list = byAgent.get(agentId) ?? [];
      list.push({ dir, revision: read.revision, file: read.file });
      byAgent.set(agentId, list);
    }
  }

  /** The one source folder an agent has here, for `{ agentId }` references. */
  const folderOf = (agentId: string): { dir: string } | { problem: string } => {
    const found = byAgent.get(agentId) ?? [];
    if (found.length === 1) return { dir: found[0]!.dir };
    if (found.length === 0) return { problem: `Agent ${agentId} has no folder on this computer.` };
    return { problem: `Agent ${agentId} has more than one folder on this computer.` };
  };

  const reports: SetupReport[] = [];

  for (const [agentId, found] of byAgent) {
    if (found.length > 1) {
      reports.push({
        agentId,
        sourcePath: found[0]!.dir,
        configRevision: found[0]!.revision,
        references: [],
        status: 'duplicate',
        problem: `More than one folder on this computer is set up for this agent: ${found.map((f) => f.dir).join(', ')}. Keep one.`,
      });
      continue;
    }
    const { dir, revision, file } = found[0]!;
    const mapping = file.agents[agentId]!.references;
    const references = (input.expected[agentId] ?? []).map((ref): ReferenceReport => {
      if (!(ref.alias in mapping)) {
        return {
          alias: ref.alias,
          form: 'unconfigured',
          path: null,
          exists: false,
          problem: `Reference "${ref.alias}" isn't set up on this computer. Choose its folder, or leave it out here.`,
        };
      }
      const value = mapping[ref.alias]!;
      if (value === null) return { alias: ref.alias, value, form: 'omitted', path: null, exists: false, problem: null };
      if (typeof value === 'string') {
        const resolved = path.resolve(dir, value);
        const exists = isDir(resolved);
        return {
          alias: ref.alias,
          value,
          form: 'path',
          path: resolved,
          exists,
          problem: exists ? null : `Reference "${ref.alias}" points at ${resolved}, which doesn't exist.`,
        };
      }
      const target = folderOf(value.agentId);
      if ('problem' in target) {
        return { alias: ref.alias, value, form: 'agent', path: null, exists: false, problem: target.problem };
      }
      return { alias: ref.alias, value, form: 'agent', path: target.dir, exists: true, problem: null };
    });
    const blocking = references.find((r) => r.problem);
    reports.push({
      agentId,
      sourcePath: dir,
      configRevision: revision,
      references,
      status: blocking ? 'missing_reference' : 'ready',
      problem: blocking?.problem ?? null,
    });
  }

  // Agents last seen in a folder that now has a problem still report, so the
  // home can show what broke and offer the fix.
  for (const [agentId, dir] of Object.entries(input.lastSeen ?? {})) {
    if (byAgent.has(agentId)) continue;
    const problem = locationProblem.get(dir);
    if (problem) {
      reports.push({
        agentId,
        sourcePath: dir,
        configRevision: problem.revision,
        references: [],
        status: problem.status,
        problem: problem.problem,
      });
    }
    // Otherwise the folder's file is readable and this agent was taken out
    // of it: the file is the authority, so the agent isn't set up here any
    // more. It isn't reported, and the home drops it.
  }

  return reports.sort((a, b) => a.agentId.localeCompare(b.agentId));
}
