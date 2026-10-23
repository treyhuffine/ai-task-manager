import { teamSharesPersonalComputer } from '@/lib/team/shared-computer';
import type { RequestKey } from '@/lib/auth/request-key';
import { getHome, memberForApiKey, TeamError } from '@/lib/db/queries';
import type { HomeRecord, MemberRecord } from '@/db/types';
import { hasTeamCapability, teamCapabilities } from '@/lib/team/capabilities';
import type { TeamCapabilities } from '@/lib/team/capabilities';
import { pageViewerKey } from '@/lib/auth/page-key';

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
      executionChoices: [executionChoice(home)],
      capabilities: { ...teamCapabilities({ role: 'owner', status: 'active' }), administerMembers: false, privatePlanning: true, personalServices: true },
    };
  }
  const member = key?.scope === 'member' && key.memberId ? memberForApiKey(key.apiKeyId) : null;
  if (!member || member.id !== key?.memberId) throw new TeamError('not_allowed', 'Sign in as an active member of this Home.');
  return {
    home: { id: home.id, kind: home.kind, name: home.name },
    viewer: { id: member.id, name: member.name, role: member.role },
    executionChoices: [executionChoice(home)],
    ...(hasTeamCapability(member, 'configureAgents') ? { sharedComputer: teamSharesPersonalComputer() } : {}),
    capabilities: { ...teamCapabilities(member), privatePlanning: false, personalServices: false },
  };
}

function executionChoice(home: HomeContext['home']): HomeContext['executionChoices'][number] {
  return { id: `${home.kind}:${home.id}`, homeId: home.id, name: home.kind === 'team' ? "This team's server" : home.name,
    kind: home.kind === 'team' ? 'team_server' : 'personal', audience: home.kind === 'team' ? 'team' : 'personal' };
}

/** Only an authenticated browser credential may seed the browser cache.
 * Pairing links and signed-out pages resolve their identity after sign-in. */
export async function initialHomeContextForRequest(headers: Pick<Headers, 'get'>): Promise<HomeContext | undefined> {
  const key = pageViewerKey(headers);
  if (!key) return undefined;
  try {
    return await resolveHomeContext(key);
  } catch (error) {
    if (error instanceof TeamError && ['not_allowed', 'not_found'].includes(error.code)) return undefined;
    throw error;
  }
}
