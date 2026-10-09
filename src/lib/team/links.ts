/**
 * Team links (docs/homes-spec.md §3.1). A grant's secret rides in the
 * fragment, which browsers never send to a server or write to its logs:
 *
 *   <team>/join#invite=<secret>     an invitation
 *   <team>/join#sign-in=<secret>    signing an existing member in elsewhere
 *   <team>/join#setup=<secret>      finishing a team its operator provisioned
 *
 * A personal pairing link is `<home>/#token=<key>`. The desktop's Connect
 * to Ri accepts either and tells them apart by shape, then asks the address
 * itself what kind of Ri answers.
 *
 * Pure: the desktop and the browser parse links with it too.
 */

export type TeamLinkKind = 'invite' | 'sign-in' | 'setup';
export const TEAM_LINK_KINDS: readonly TeamLinkKind[] = ['invite', 'sign-in', 'setup'];
export const TEAM_JOIN_PATH = '/join';

export function teamLink(base: string, kind: TeamLinkKind, secret: string): string {
  return `${base.replace(/\/+$/, '')}${TEAM_JOIN_PATH}#${kind}=${secret}`;
}

export interface ParsedTeamLink {
  origin: string;
  kind: TeamLinkKind;
  secret: string;
}

/** A team link's parts, or null for anything else. Never throws. */
export function parseTeamLink(raw: string): ParsedTeamLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.pathname.replace(/\/+$/, '') !== TEAM_JOIN_PATH) return null;
  const params = new URLSearchParams(url.hash.replace(/^#/, ''));
  const kinds = TEAM_LINK_KINDS.filter((kind) => params.has(kind));
  if (kinds.length !== 1) return null;
  const secret = params.get(kinds[0])?.trim() ?? '';
  if (!/^rtg_[A-Za-z0-9_-]{16,}$/.test(secret)) return null;
  return { origin: url.origin, kind: kinds[0], secret };
}
