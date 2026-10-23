import { isTeamAuthority } from './authority';
import { requireTeamCapability } from '@/lib/team/capability-authority';
import type { TeamAction } from '@/lib/team/capabilities';
import { getRequestKey } from '@/lib/auth/request-key';
import { getHome } from '@/lib/db/queries';
import { failure } from '@/lib/server/operation';

/** Ordinary settings operations serve both Homes, with the Home's named permission. */
export function homeSettingsAdmission(headers: Headers, action: TeamAction, deviceId?: unknown) {
  if (!isTeamAuthority()) return null;
  try {
    requireTeamCapability(getRequestKey(headers), action);
    if (deviceId !== undefined && deviceId !== getHome()?.hostDeviceId) return failure({ error: 'not_allowed', message: 'Team agents currently run on this team server.' }, 403);
    return null;
  }
  catch (error) { return failure({ error: 'not_allowed', message: error instanceof Error ? error.message : 'This sign-in cannot change these settings.' }, 403); }
}
