import { getHome, isWorkerApiKey } from '@/lib/db/queries';
import { teamCallerFor, teamSessionCookieName } from '@/lib/team/credential';
import { lookupApiToken } from './api-token';
import { isHostKeyHash } from './host-key';
import type { RequestKey } from './request-key';
import { SESSION_COOKIE_NAME } from './session';
import { isSessionToken } from './session-token';

/** Pages are public shells and do not pass through the API proxy. Authenticate
 * their real cookie/Bearer credential, never inbound forwarded-key headers. */
export function pageViewerKey(headers: Pick<Headers, 'get'>): RequestKey | null {
  const home = getHome();
  if (!home) return null;
  const cookieName = home.kind === 'team' ? teamSessionCookieName() : SESSION_COOKIE_NAME;
  const cookie = headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`));
  let cookieToken: string | null = null;
  try { cookieToken = cookie ? decodeURIComponent(cookie.slice(cookieName.length + 1)) : null; } catch { /* malformed cookies do not authenticate */ }
  const authorization = headers.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : cookieToken;
  if (!token || isSessionToken(token)) return null;
  const found = lookupApiToken(token);
  if (!found || found.key.role === 'ai_client' || isWorkerApiKey(found.key.id)) return null;
  const base = { apiKeyId: found.key.id, workerDeviceId: null, sessionChatId: null };
  if (home.kind === 'team') {
    const caller = teamCallerFor(found.key, found.tokenHash);
    return caller?.scope === 'member' ? { ...base, scope: 'member', location: 'elsewhere', memberId: caller.member.id, memberRole: caller.member.role } : null;
  }
  return { ...base, scope: 'viewer', location: isHostKeyHash(found.tokenHash) ? 'home' : 'elsewhere' };
}
