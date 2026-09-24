/**
 * The home's side of setups: what a computer needs to resolve its setup
 * files (docs/homes-spec.md §4.2), and the link the home's own computer uses
 * to set up folders in-process.
 */

import {
  expectedReferenceAliases,
  getHome,
  listAgentSetups,
  listWorkspaces,
  recordAgentSetupReports,
} from '@/lib/db/queries';
import type { ComputerRecord } from '@/db/types';
import { ensureHomeIdentity } from '@/lib/home/identity';
import type { SetupContext, SetupHomeLink } from './service';

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
