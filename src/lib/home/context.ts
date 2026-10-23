import { executionRecoveryProblem } from './execution-startup';
import { teamSharesPersonalComputer } from '@/lib/team/shared-computer';
import type { RequestKey } from '@/lib/auth/request-key';
import { getHome, memberForApiKey, getTeamAiSettings, listWorkspaces, TeamError } from '@/lib/db/queries';
import type { HomeRecord, MemberRecord } from '@/db/types';
import { HARNESS_IDS } from '@/lib/harness/registry';
import { getHarnessRuntime, resolveHarnessAuth } from '@/lib/harness/runtime';
import { hasTeamCapability, teamCapabilities } from '@/lib/team/capabilities';
import type { TeamCapabilities } from '@/lib/team/capabilities';

/** Data ownership and execution ownership are deliberately separate. */
export interface HomeContext {
  home: Pick<HomeRecord, 'id' | 'kind' | 'name'>;
  viewer: { id: string; name: string; role: MemberRecord['role'] | 'personal' };
  executionChoices: {
    id: string;
    homeId: string;
    name: string;
    kind: 'personal' | 'team_server';
    audience: 'personal' | 'team';
    available: boolean;
    unavailableReason: string | null;
  }[];
  sharedComputer?: boolean;
  capabilities: TeamCapabilities & { privatePlanning: boolean; personalServices?: boolean };

}

/** Resolve live authority on the server, never from a selected browser view. */
export async function resolveHomeContext(key: RequestKey | null): Promise<HomeContext> {
  const home = getHome();
  if (!home) throw new TeamError('not_found', 'This Home is not ready.');
  if (home.kind === 'personal') {
    if (key?.scope !== 'viewer') throw new TeamError('not_allowed', 'Sign in to this Home.');
    return {
      home: { id: home.id, kind: home.kind, name: home.name },
      viewer: { id: 'local', name: home.name, role: 'personal' },
      executionChoices: [await executionChoice(home, true)],
      capabilities: { ...teamCapabilities({ role: 'owner', status: 'active' }), administerMembers: false, privatePlanning: true, personalServices: true },
    };
  }
  const member = key?.scope === 'member' && key.memberId ? memberForApiKey(key.apiKeyId) : null;
  if (!member || member.id !== key?.memberId) throw new TeamError('not_allowed', 'Sign in as an active member of this Home.');
  const executionChoices = [await executionChoice(home, Boolean(getTeamAiSettings()?.enabled))];
  if (memberForApiKey(key!.apiKeyId)?.id !== member.id) throw new TeamError('not_allowed', 'This sign-in is no longer active.');
  return {
    home: { id: home.id, kind: home.kind, name: home.name },
    viewer: { id: member.id, name: member.name, role: member.role },
    executionChoices,
    ...(hasTeamCapability(member, 'configureAgents') ? { sharedComputer: teamSharesPersonalComputer() } : {}),
    capabilities: { ...teamCapabilities(member), privatePlanning: false, personalServices: false },
  };
}

async function executionChoice(home: HomeRecord, enabled: boolean): Promise<HomeContext['executionChoices'][number]> {
  const agents = listWorkspaces({ status: 'active' });
  const recoveryProblem = home.kind === 'team' ? executionRecoveryProblem() : null;
  const ready = !recoveryProblem && enabled && agents.length > 0 && (await Promise.all(HARNESS_IDS.map(async harness => {
    try {
      const [runtime, auth] = await Promise.all([getHarnessRuntime(harness), resolveHarnessAuth(harness)]);
      return runtime.binary.status === 'supported' && auth.options.some(option => option.present);
    } catch { return false; }
  }))).some(Boolean);
  return { id: `${home.kind}:${home.id}`, homeId: home.id, name: home.kind === 'team' ? "This team's server" : home.name,
    kind: home.kind === 'team' ? 'team_server' : 'personal', audience: home.kind === 'team' ? 'team' : 'personal',
    available: ready, unavailableReason: ready ? null : recoveryProblem ?? (!enabled ? 'Team AI is off.' : !agents.length ? 'Configure an agent first.' : 'Install and sign in to a harness in Settings.') };
}
