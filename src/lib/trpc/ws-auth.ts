import { TRPCError } from '@trpc/server';
import { lookupApiToken } from '@/lib/auth/api-token';
import { isHostKeyHash } from '@/lib/auth/host-key';
import { permitsCookieMutation } from '@/lib/auth/request-origin';
import { API_KEY_ID_HEADER, API_KEY_SCOPE_HEADER, CALLER_LOCATION_HEADER, FORWARDED_KEY_HEADERS, MEMBER_ID_HEADER, MEMBER_ROLE_HEADER } from '@/lib/auth/request-key';
import { isTeamAuthority } from '@/lib/home/authority';
import { teamCallerFor, teamSessionCookieName } from '@/lib/team/credential';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { isSessionToken } from '@/lib/auth/session-token';
import { isWorkerApiKey, touchApiKey } from '@/lib/db/queries';
import { isHomeActive } from '@/lib/home/identity';
import { apiCompatibilityIssue } from '@/lib/releases/api-contract';
import { CURRENT_COMPATIBILITY } from '@/lib/releases/compatibility';
import { OperationError } from '@/lib/server/operation';
import { readMaintenance } from '@/lib/service/maintenance-state';
import { createTRPCContext } from './init';

/** An upgrade is a write-capable connection, even though its HTTP method is GET.
 * Reject foreign browser origins for bearer connections as well as cookies. */
export function permitsWebSocketOrigin(request: Request): boolean {
  if (!request.headers.has('origin')) return true; // Native clients have no ambient browser authority.
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  return permitsCookieMutation(new Request(request.url, { method: 'POST', headers }));
}

function cookieToken(headers: Headers): string | null {
  // A team's session cookie has its own name (src/lib/team/credential.ts).
  const name = isTeamAuthority() ? teamSessionCookieName() : SESSION_COOKIE_NAME;
  const raw = headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  try { return raw ? decodeURIComponent(raw.slice(name.length + 1)) : null; } catch { return null; }
}

/** In a team, only a member's sign-in opens a connection, and it acts as that member. */
function teamMember(found: { key: { id: string }; tokenHash: string }) {
  if (!isTeamAuthority()) return null;
  const caller = teamCallerFor(found.key, found.tokenHash);
  if (caller?.scope !== 'member') throw new TRPCError({ code: 'UNAUTHORIZED' });
  return caller.member;
}

export function createWebSocketContext(request: Request, params: Record<string, string | undefined> | null) {
  if (!permitsWebSocketOrigin(request)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Request origin is not allowed.' });
  const token = params?.token || request.headers.get('authorization')?.replace(/^Bearer /, '') || cookieToken(request.headers);
  const protocol = params?.protocol ?? request.headers.get('x-ri-api-protocol');
  const validate = () => {
    if (!token) throw new TRPCError({ code: 'UNAUTHORIZED' });
    if (isSessionToken(token)) throw new TRPCError({ code: 'FORBIDDEN' });
    const found = lookupApiToken(token);
    if (!found) throw new TRPCError({ code: 'UNAUTHORIZED' });
    if (isWorkerApiKey(found.key.id)) throw new TRPCError({ code: 'FORBIDDEN' });
    const mismatch = apiCompatibilityIssue(protocol, CURRENT_COMPATIBILITY.apiProtocols);
    if (mismatch) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: mismatch.message, cause: new OperationError(426, mismatch) });
    if (!isHomeActive() || process.env.RI_SERVICE_VALIDATING === '1' || readMaintenance()?.phase === 'offline') {
      throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Home is preparing an update. Please retry shortly.' });
    }
    return { ...found, member: teamMember(found) };
  };
  const { key, tokenHash, member } = validate();
  const headers = new Headers(request.headers);
  // Some operations require an explicit credential as well as the verified
  // key, including connected-computer notification ownership.
  headers.set('authorization', `Bearer ${token}`);
  for (const name of FORWARDED_KEY_HEADERS) headers.delete(name);
  headers.set(API_KEY_ID_HEADER, key.id);
  if (member) {
    headers.set(API_KEY_SCOPE_HEADER, 'member');
    headers.set(MEMBER_ID_HEADER, member.id);
    headers.set(MEMBER_ROLE_HEADER, member.role);
    headers.set(CALLER_LOCATION_HEADER, 'elsewhere');
  } else {
    headers.set(API_KEY_SCOPE_HEADER, 'viewer');
    headers.set(CALLER_LOCATION_HEADER, isHostKeyHash(tokenHash) ? 'home' : 'elsewhere');
  }
  try { touchApiKey(key.id, { ip: headers.get('x-forwarded-for'), userAgent: headers.get('user-agent') }); } catch { /* telemetry is best effort */ }
  const ctx = createTRPCContext(new Request(request.url, { headers, signal: request.signal }));
  return { ...ctx, authorize: () => {
    const current = validate();
    if (current.member) {
      // A member removed or demoted while connected: the role follows, and
      // removal closes the connection (validate throws).
      ctx.key!.memberRole = current.member.role;
      return;
    }
    const location = isHostKeyHash(current.tokenHash) ? 'home' : 'elsewhere';
    ctx.key!.location = location;
    ctx.request.headers.set(CALLER_LOCATION_HEADER, location);
  } };
}
