import { expect, it } from 'vitest';
import { hasTeamCapability, TEAM_ACTIONS, teamCapabilities } from './capabilities';

it.each(['owner', 'member'] as const)('allows %s to control another member’s team work', role => {
  const member = { role, status: 'active' as const };
  for (const action of ['stopTurn', 'cancelQueued', 'answerQuestion', 'approvePermission', 'archiveChat', 'editAgentFolder', 'openAgentTerminal'] as const) {
    expect(hasTeamCapability(member, action), action).toBe(true);
  }
});

it.each(['owner', 'member'] as const)('never lets an agent acting for an %s answer, approve or deny a prompt', role => {
  for (const action of ['answerQuestion', 'approvePermission'] as const) {
    expect(hasTeamCapability({ role, status: 'active' }, action, 'agent')).toBe(false);
  }
});

it('keeps record destruction and agent/account administration with the owner', () => {
  for (const action of ['deletePermanently', 'administerMembers', 'configureAgents', 'manageSignIns'] as const) {
    expect(hasTeamCapability({ role: 'owner', status: 'active' }, action)).toBe(true);
    expect(hasTeamCapability({ role: 'member', status: 'active' }, action)).toBe(false);
  }
});

it('denies every action to a removed member and derives the complete UI capability record', () => {
  for (const action of TEAM_ACTIONS) expect(hasTeamCapability({ role: 'owner', status: 'removed' }, action)).toBe(false);
  const record = teamCapabilities({ role: 'member', status: 'active' });
  expect(Object.keys(record)).toEqual([...TEAM_ACTIONS]);
  expect(record).toMatchObject({ read: true, editContent: true, configureAgents: false });
});
