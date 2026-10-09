/**
 * Who a validated key is in a team space (docs/homes-spec.md §9.1, P6.1).
 *
 * A team has two kinds of caller and nothing else:
 *
 * - a **member**: an active sign-in key of an active member. It acts as
 *   that member, on the team's shared work only.
 * - the **host**: the host's own key (`localToken` in the team root's
 *   config). It administers the installation: creating the first owner from
 *   the trusted local flow, making a setup link, the service. It is never a
 *   member and reads no shared work.
 *
 * Any other key is refused. A personal key can't exist here: a team root
 * never had a personal owner, and its keys come only from its own grants.
 */

import { APP_SHORT_ID } from '@/constants/app';
import { isHostKeyHash } from '@/lib/auth/host-key';
import { getDbPath } from '@/lib/config/paths';
import { getHome, memberForApiKey } from '@/lib/db/queries';
import type { ApiKeyRecord, MemberRecord } from '@/db/types';

export type TeamCaller = { scope: 'member'; member: MemberRecord } | { scope: 'host' };

export function teamCallerFor(key: Pick<ApiKeyRecord, 'id'>, tokenHash: string): TeamCaller | null {
  if (isHostKeyHash(tokenHash)) return { scope: 'host' };
  const member = memberForApiKey(key.id);
  return member ? { scope: 'member', member } : null;
}

let cookieCache: { dbPath: string; name: string } | null = null;

/**
 * The team's own session cookie name. Browsers don't keep cookies apart by
 * port, so a team and a personal Ri on one computer would otherwise sign each
 * other out. Named by the team's id, which never changes.
 */
export function teamSessionCookieName(): string {
  const dbPath = getDbPath();
  if (cookieCache?.dbPath === dbPath) return cookieCache.name;
  const id = getHome()?.id;
  if (!id) return `${APP_SHORT_ID}_team_session`;
  const name = `${APP_SHORT_ID}_team_${id.replace(/[^a-zA-Z0-9]/g, '').slice(-12)}`;
  cookieCache = { dbPath, name };
  return name;
}

/** Where a member's key may go: the team's shared work and its own routes. */
const MEMBER_PREFIXES = ['/api/trpc', '/api/attachments', '/api/team'];
const MEMBER_PATHS = new Set(['/api/version', '/api/home']);

export function memberMayReach(pathname: string): boolean {
  if (pathname.startsWith('/api/team/host')) return false;
  if (MEMBER_PATHS.has(pathname)) return true;
  return MEMBER_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Where the host's key may go: installation administration only. */
const HOST_PREFIXES = ['/api/team/host', '/api/service'];
const HOST_PATHS = new Set(['/api/version', '/api/home']);

export function hostMayReach(pathname: string): boolean {
  if (HOST_PATHS.has(pathname)) return true;
  return HOST_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Routes anyone may call on a team: the grant itself is the credential.
 * Previewing an invitation, joining with one, signing in with a sign-in link,
 * and finishing setup with an operator's setup link.
 */
export const TEAM_PUBLIC_PREFIX = '/api/team/public';

export function isTeamPublicPath(pathname: string): boolean {
  return pathname === TEAM_PUBLIC_PREFIX || pathname.startsWith(`${TEAM_PUBLIC_PREFIX}/`);
}
