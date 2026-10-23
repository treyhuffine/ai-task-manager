import type { RequestKey } from '@/lib/auth/request-key';
import * as q from '@/lib/db/queries';
import { hasTeamCapability, type TeamAction } from './capabilities';

/** Resolve live membership and credential scope at every transport admission. */
export function requireTeamCapability(key: RequestKey | null, action: TeamAction) {
  const member = key?.memberId ? q.memberForApiKey(key.apiKeyId) : null;
  const principal = key?.scope === 'member' && !key.sessionChatId ? 'human' : 'agent';
  if (q.getHome()?.kind !== 'team' || !member || member.id !== key?.memberId
    || !hasTeamCapability(member, action, principal)) {
    throw new q.TeamError('not_allowed', 'This sign-in cannot perform that team action.');
  }
  return member;
}
