import { isTeamAuthority } from '@/lib/home/authority';
import { OAUTH_CORS_HEADERS } from './issuer';
import type { OAuthReply } from './flow';

/** An OAuth answer: JSON that no cache keeps (RFC 6749 §5.1), readable from a browser client. */
export function oauthResponse(reply: OAuthReply): Response {
  return Response.json(reply.body, {
    status: reply.status,
    headers: { ...OAUTH_CORS_HEADERS, 'Cache-Control': 'no-store', Pragma: 'no-cache', ...reply.headers },
  });
}

export function oauthPreflight(): Response {
  return new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}

/**
 * Signing in to an outside assistant is a personal Ri's. A team connects AI
 * clients with its members' own keys (docs/homes-spec.md §9.8), so here a
 * team answers as if Ri's OAuth weren't there.
 */
export function teamRefusal(): Response | null {
  let team: boolean;
  try { team = isTeamAuthority(); } catch { team = true; }
  return team ? oauthResponse({ status: 404, body: { error: 'not_found', error_description: 'A team connects AI clients from its own settings.' } }) : null;
}
