/** The team as its members see it, and as an invitation names it. Server only. */

import { getDevice, getHome, listMembers } from '@/lib/db/queries';

export interface TeamSummary {
  id: string;
  name: string;
  members: number;
  /** The computer the team runs on, as its host named it, so people know where it lives. */
  hostedOn: string | null;
}

export function teamSummary(): TeamSummary {
  const team = getHome();
  if (!team || team.kind !== 'team') throw new Error('This is not a team space.');
  return { id: team.id, name: team.name, members: listMembers().length, hostedOn: getDevice(team.hostDeviceId)?.name ?? null };
}
