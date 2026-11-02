/** The team as its members see it, and as an invitation names it. Server only. */

import { getDevice, getHome, getUserState, listMembers } from '@/lib/db/queries';
import type { UserStateRecord } from '@/db/types';

export interface TeamSummary {
  id: string;
  name: string;
  members: number;
  /** The computer the team runs on, as its host named it, so people know where it lives. */
  hostedOn: string | null;
  /** Older Teams may omit their logo from the member summary. */
  logo?: UserStateRecord['orchestratorImage'];
}

export function teamSummary(): TeamSummary {
  const team = getHome();
  if (!team || team.kind !== 'team') throw new Error('This is not a team space.');
  return { id: team.id, name: team.name, members: listMembers().length, logo: getUserState()?.orchestratorImage ?? null, hostedOn: getDevice(team.hostDeviceId)?.name ?? null };
}
