/** Team role policy. Transports resolve a live member before asking this table. */
import type { MemberRecord } from '@/db/types';

export const TEAM_ACTIONS = [
  'read', 'editContent', 'deletePermanently', 'administerMembers', 'configureAgents',
  'runTeamAgent', 'stopTurn', 'cancelQueued', 'answerQuestion', 'approvePermission',
  'archiveChat', 'editAgentFolder', 'openAgentTerminal', 'manageSignIns',
] as const;
export type TeamAction = typeof TEAM_ACTIONS[number];
export type TeamCapabilities = Record<TeamAction, boolean>;

const CAPABILITIES: Record<MemberRecord['role'], readonly TeamAction[]> = {
  owner: TEAM_ACTIONS,
  member: ['read', 'editContent', 'runTeamAgent', 'stopTurn', 'cancelQueued',
    'answerQuestion', 'approvePermission', 'archiveChat', 'editAgentFolder', 'openAgentTerminal'],
};
const PERSON_ONLY: readonly TeamAction[] = ['answerQuestion', 'approvePermission', 'manageSignIns'];

/** A role never grants an agent permission to answer or approve a prompt. */
export function hasTeamCapability(
  member: Pick<MemberRecord, 'role' | 'status'> | null | undefined,
  action: TeamAction,
  principal: 'human' | 'agent' = 'human',
): boolean {
  return member?.status === 'active' && (principal === 'human' || !PERSON_ONLY.includes(action))
    && CAPABILITIES[member.role]?.includes(action) === true;
}

export function teamCapabilities(member: Pick<MemberRecord, 'role' | 'status'>, principal: 'human' | 'agent' = 'human'): TeamCapabilities {
  return Object.fromEntries(TEAM_ACTIONS.map(action => [action, hasTeamCapability(member, action, principal)])) as TeamCapabilities;
}

/** Role parsing and display are policy data, never scattered owner comparisons. */
export function isTeamRole(value: unknown): value is MemberRecord['role'] {
  return typeof value === 'string' && Object.hasOwn(CAPABILITIES, value);
}
export const TEAM_ROLE_LABELS: Record<MemberRecord['role'], string> = { owner: 'Owner', member: 'Member' };

/** SQL filters derive from the same policy, rather than hardcoding a privileged role. */
export function teamRolesForCapability(action: TeamAction): MemberRecord['role'][] {
  return (Object.keys(CAPABILITIES) as MemberRecord['role'][]).filter(role => hasTeamCapability({ role, status: 'active' }, action));
}
