import { API_PROTOCOL_HEADER, apiCompatibilityIssue, hasIndependentProtocol } from '@/lib/releases/api-contract';
import { SPACE_HEADER, SPACE_PATH_PREFIX, spaceIdFromPath } from '@/lib/spaces/document';
import { CURRENT_COMPATIBILITY } from '@/lib/releases/compatibility';
import { NextResponse, type NextRequest } from 'next/server';
import { HOME_MCP_PATH, isPersonalAiClientKey } from '@/lib/external-ai/policy';
import { lookupApiToken } from '@/lib/auth/api-token';
import { activeTeamChatTurn, getWorkerDevice, isWorkerApiKey, touchApiKey } from '@/lib/db/queries';
import { isTurnToken, readTurnToken } from '@/lib/team/ai/turn-credential';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { isHomeActive } from '@/lib/home/identity';
import {
  API_KEY_ID_HEADER,
  API_KEY_SCOPE_HEADER,
  CALLER_LOCATION_HEADER,
  FORWARDED_KEY_HEADERS,
  MEMBER_ID_HEADER,
  MEMBER_ROLE_HEADER,
  SESSION_CHAT_HEADER,
  TEAM_AI_TURN_HEADER,
  WORKER_DEVICE_HEADER,
} from '@/lib/auth/request-key';
import { isTeamAuthority } from '@/lib/home/authority';
import { aiClientMayReach, hostMayReach, isTeamPublicPath, memberMayReach, TEAM_MCP_PATH, teamCallerFor, teamSessionCookieName } from '@/lib/team/credential';
import { isSessionToken, sessionMayReach, verifySessionToken } from '@/lib/auth/session-token';
import { isHostKeyHash } from '@/lib/auth/host-key';
import { permitsCookieMutation } from '@/lib/auth/request-origin';
import { localAppsEnabled } from '@/lib/config/features';

export const config = {
  // `/space/*` is a page: the proxy only marks which team it shows (below).
  matcher: ['/api/:path*', '/space/:path*'],
};

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

/** Where a worker key may go, and only a worker key (docs/homes-build.md, P2.2). */
const WORKER_ROUTES = '/api/workers/me';

function isWorkerRoute(pathname: string): boolean {
  return pathname === WORKER_ROUTES || pathname.startsWith(`${WORKER_ROUTES}/`);
}

function forbidden(error: string, message: string) {
  return NextResponse.json({ error, message }, { status: 403 });
}

// Paths that bypass auth. `/api/health` is our cross-origin reachability
// probe used by the CLI and the web UI's "Test connection" button. It only
// returns { ok, app, port } — nothing sensitive — so it's safe to leave
// unauthenticated, and CORS on the route handler lets browsers read it.
//
// `/api/session` is public because its handlers manage the session cookie
// themselves — POST re-validates the Bearer header inside the handler, and
// DELETE must work even when the caller's token is already invalid (so they
// can complete a logout cleanly).
const PUBLIC_PATHS = new Set<string>(['/api/health', '/api/session']);

/**
 * Extract the caller's API token. Two transports, same underlying key:
 *
 *   - `Authorization: Bearer <token>` — used by CLIs, iOS Shortcuts, service
 *     integrations, and in-app `fetch` calls that explicitly attach the
 *     header. Works everywhere `fetch` goes.
 *   - Session cookie — set by `/api/session` after a successful pair. Exists
 *     solely so browser-native loads (`<img>`, `<audio>`, `EventSource`,
 *     form posts) authenticate without us having to attach headers they
 *     can't carry.
 *
 * Bearer wins when both are present — it's the explicit choice the caller
 * made.
 */
function extractToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) return token;
  }

  const cookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (cookie?.value) return cookie.value;

  return null;
}

/** Continue with the caller's key headers removed, so no handler trusts a forged one. */
function nextWithoutKeyHeaders(request: NextRequest) {
  const headers = new Headers(request.headers);
  for (const h of FORWARDED_KEY_HEADERS) headers.delete(h);
  return NextResponse.next({ request: { headers } });
}

/**
 * A team space's boundary (docs/homes-spec.md §9.1, §9.2, P6.3). Its own
 * session cookie, so a team and a personal Ri on one computer never sign
 * each other out. Grants are their own credential on the public team
 * routes. Otherwise a key is a member's, reaching only the team's shared
 * work, or the host's own, reaching only installation administration.
 * Every personal route answers as if it weren't there.
 */
function teamProxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isTeamPublicPath(pathname)) return nextWithoutKeyHeaders(request);

  const cookieName = teamSessionCookieName();
  if (request.cookies.get(cookieName)?.value && !permitsCookieMutation(request)) {
    return NextResponse.json({ error: 'request origin is not allowed' }, { status: 403 });
  }
  const header = request.headers.get('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  // One turn of the team's own AI, acting for the member who asked (§9.9).
  if (bearer && isTurnToken(bearer)) return teamAiTurnProxy(request, bearer);
  const token = bearer || request.cookies.get(cookieName)?.value || null;
  if (!token || isSessionToken(token)) return unauthorized();
  const found = lookupApiToken(token);
  if (!found) return unauthorized();
  const caller = teamCallerFor(found.key, found.tokenHash);
  if (!caller) return unauthorized();

  // An AI client speaks MCP, not the app's own API protocol.
  if (caller.scope !== 'ai_client' && !hasIndependentProtocol(pathname) && pathname !== '/api/version') {
    const mismatch = apiCompatibilityIssue(request.headers.get(API_PROTOCOL_HEADER), CURRENT_COMPATIBILITY.apiProtocols);
    if (mismatch) return NextResponse.json(mismatch, { status: 426, headers: { 'Cache-Control': 'no-store' } });
  }
  if (caller.scope === 'host' && !hostMayReach(pathname)) {
    return forbidden('host_key', "The host's key looks after this installation. Sign in as a member to use the team.");
  }
  if (caller.scope === 'member' && !memberMayReach(pathname)) {
    return NextResponse.json({ error: 'not_in_team', message: "That isn't part of a team space." }, { status: 404 });
  }
  if (caller.scope === 'ai_client' && !aiClientMayReach(pathname, request.method)) {
    return forbidden('ai_client_key', "An AI client's key reaches only the team's MCP and the files its records link to.");
  }
  // A member's sign-in can't reach the MCP: it's for the AI clients they connect.
  if (caller.scope === 'member' && pathname === TEAM_MCP_PATH) {
    return forbidden('sign_in_key', 'Connect your AI from the team, and give it the key that makes.');
  }
  try {
    touchApiKey(found.key.id, {
      ip: request.headers.get('x-forwarded-for') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    });
  } catch (err) {
    console.error('[auth] touchApiKey failed:', err);
  }
  const headers = new Headers(request.headers);
  for (const h of FORWARDED_KEY_HEADERS) headers.delete(h);
  headers.set(API_KEY_ID_HEADER, found.key.id);
  headers.set(CALLER_LOCATION_HEADER, caller.scope === 'host' ? 'home' : 'elsewhere');
  headers.set(API_KEY_SCOPE_HEADER, caller.scope);
  if (caller.scope === 'member' || caller.scope === 'ai_client') {
    headers.set(MEMBER_ID_HEADER, caller.member.id);
    headers.set(MEMBER_ROLE_HEADER, caller.member.role);
  }
  return NextResponse.next({ request: { headers } });
}

/**
 * A team AI turn's credential: signed by the team, alive only while its turn
 * runs, its member is in the team and Team AI is on. It reaches the team's
 * MCP and nothing else.
 */
function teamAiTurnProxy(request: NextRequest, token: string) {
  const claims = readTurnToken(token);
  const active = claims ? activeTeamChatTurn(claims) : null;
  if (!claims || !active) return unauthorized();
  if (request.nextUrl.pathname !== TEAM_MCP_PATH) {
    return forbidden('team_ai_turn', "The team AI's credential reaches only the team's tools.");
  }
  const headers = new Headers(request.headers);
  for (const h of FORWARDED_KEY_HEADERS) headers.delete(h);
  headers.set(API_KEY_ID_HEADER, `team-ai-turn:${claims.turnId}`);
  headers.set(CALLER_LOCATION_HEADER, 'elsewhere');
  headers.set(API_KEY_SCOPE_HEADER, 'team_ai');
  headers.set(MEMBER_ID_HEADER, active.member.id);
  headers.set(MEMBER_ROLE_HEADER, active.member.role);
  headers.set(TEAM_AI_TURN_HEADER, claims.turnId);
  return NextResponse.next({ request: { headers } });
}

export function proxy(request: NextRequest) {
  // A team's space in My Ri (docs/homes-spec.md §3.2, P7.1) is a page of its
  // own. Pages aren't authenticated here: its API calls are, through
  // `/api/space/<team>`. The layout learns which team from this header,
  // which only the proxy sets.
  if (request.nextUrl.pathname.startsWith(SPACE_PATH_PREFIX)) {
    const headers = new Headers(request.headers);
    const id = spaceIdFromPath(request.nextUrl.pathname);
    if (id) headers.set(SPACE_HEADER, id);
    else headers.delete(SPACE_HEADER);
    return NextResponse.next({ request: { headers } });
  }
  if (process.env.NODE_ENV === 'production' &&
      /^\/api\/(dev|playground|benchmark)(\/|$)/.test(request.nextUrl.pathname)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    if (request.nextUrl.pathname === '/api/session' && !permitsCookieMutation(request)) {
      return NextResponse.json({ error: 'request origin is not allowed' }, { status: 403 });
    }
    return nextWithoutKeyHeaders(request);
  }

  // A root whose data came from another device serves nothing until it is
  // claimed, so two copies never act as one home (docs/homes-spec.md §10.3).
  // Checked before the routes that carry their own credentials (webhooks,
  // OAuth callbacks), since those can start work too.
  if (!isHomeActive()) {
    return NextResponse.json(
      {
        error: 'home_not_active',
        message: 'This copy of your home is not active on this device. Run `ri home claim` here if it should be.',
      },
      { status: 503 },
    );
  }

  // A team space has members and its host, nothing personal, so it has its
  // own boundary (docs/homes-spec.md §9.1, P6.1/P6.3).
  let team: boolean;
  try {
    team = isTeamAuthority();
  } catch (err) {
    return NextResponse.json(
      { error: 'authority_conflict', message: err instanceof Error ? err.message : 'This folder is marked as a team, but its data is a personal Ri.' },
      { status: 503 },
    );
  }
  if (team) return teamProxy(request);

  // Local app broker credentials are verified by this narrow protocol adapter.
  if (localAppsEnabled() &&/^\/api\/local-apps\/broker\/v1\/(capabilities|call)$/.test(request.nextUrl.pathname)) return nextWithoutKeyHeaders(request);

  if (request.nextUrl.pathname.startsWith('/api/webhooks/')) {
    return nextWithoutKeyHeaders(request);
  }

  // `/api/integrations/callback` is the OAuth redirect target. The provider
  // (Google, etc.) sends the user's browser here with `?code&state`; that
  // navigation cannot carry the app's Bearer token. The handler's own security
  // is the single-use, unguessable `state` it validates against the stored
  // AuthRequest — a strictly weaker, single-purpose credential. Exempted so the
  // round-trip completes.
  if (request.nextUrl.pathname === '/api/integrations/callback') {
    return nextWithoutKeyHeaders(request);
  }

  // `/api/integrations/managed/callback` is where a managed source (Composio) returns the browser
  // after consent. Its only input is an unguessable single-use attempt id, and completion is
  // verified server-side through the source against that stored attempt, never the redirect.
  if (request.nextUrl.pathname === '/api/integrations/managed/callback') {
    return nextWithoutKeyHeaders(request);
  }

  // `/api/integrations/mcp-oauth/<sid>` is the OAuth redirect target for an ingested MCP server.
  // Same rationale as the integrations callback: the provider redirects the user's browser here
  // without the app Bearer; the SDK's single-use authorization code + PKCE verifier are the auth.
  if (request.nextUrl.pathname.startsWith('/api/integrations/mcp-oauth/')) {
    return nextWithoutKeyHeaders(request);
  }


  // Redeeming an enroll grant is how a device gets its first worker key, so
  // the grant in the body is the credential: short-lived, single-use, and
  // issued by an owner (docs/homes-build.md, P2.2).
  if (request.nextUrl.pathname === '/api/workers/enroll') {
    return nextWithoutKeyHeaders(request);
  }

  if (request.cookies.get(SESSION_COOKIE_NAME)?.value && !permitsCookieMutation(request)) {
    return NextResponse.json({ error: 'request origin is not allowed' }, { status: 403 });
  }

  const token = extractToken(request);
  if (!token) return unauthorized();

  // A session on a connected device speaks with a token of its own, which
  // reaches only that session's servers, in its own scope, as that session
  // (docs/homes-build.md, P2.7). It's never looked up as a key.
  if (isSessionToken(token)) {
    const session = verifySessionToken(token);
    if (!session) return unauthorized();
    if (!sessionMayReach(session.chat, request.nextUrl.pathname, request.nextUrl.searchParams)) {
      return forbidden('session_token', "A session's token reaches only that session's own servers.");
    }
    const headers = new Headers(request.headers);
    for (const h of FORWARDED_KEY_HEADERS) headers.delete(h);
    headers.set(API_KEY_ID_HEADER, session.workerApiKeyId);
    headers.set(CALLER_LOCATION_HEADER, 'elsewhere');
    headers.set(API_KEY_SCOPE_HEADER, 'session');
    headers.set(WORKER_DEVICE_HEADER, session.deviceId);
    headers.set(SESSION_CHAT_HEADER, session.chat.id);
    return NextResponse.next({ request: { headers } });
  }


  const found = lookupApiToken(token);
  if (!found) return unauthorized();
  const { key, tokenHash } = found;
  // An outside assistant reaches only the content-scoped MCP, never a viewer route.
  if (key.role === 'ai_client') {
    if (!isPersonalAiClientKey(key)) return unauthorized();
    if (request.nextUrl.pathname !== HOME_MCP_PATH) return forbidden('ai_client', 'This connection can only use the Home’s MCP tools.');
    touchApiKey(key.id, { ip: request.headers.get('x-forwarded-for'), userAgent: request.headers.get('user-agent') });
    const headers = new Headers(request.headers);
    for (const h of FORWARDED_KEY_HEADERS) headers.delete(h);
    headers.set(API_KEY_ID_HEADER, key.id);
    headers.set(CALLER_LOCATION_HEADER, 'elsewhere');
    headers.set(API_KEY_SCOPE_HEADER, 'ai_client');
    return NextResponse.next({ request: { headers } });
  }

  // An authenticated stale view is refused before route writes or effects.
  // Worker and MCP transports retain their own authenticated negotiation.
  if (!isWorkerApiKey(key.id) && !hasIndependentProtocol(request.nextUrl.pathname) && request.nextUrl.pathname !== '/api/version') {
    const mismatch = apiCompatibilityIssue(request.headers.get(API_PROTOCOL_HEADER), CURRENT_COMPATIBILITY.apiProtocols);
    if (mismatch) return NextResponse.json(mismatch, { status: 426, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    touchApiKey(key.id, {
      ip: request.headers.get('x-forwarded-for') ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    });
  } catch (err) {
    console.error('[auth] touchApiKey failed:', err);
  }

  // A worker key reaches only the worker routes, and only a worker key
  // reaches them: a worker can't read the owner's data, and a viewing key
  // can't pose as a worker.
  const workerRoute = isWorkerRoute(request.nextUrl.pathname);
  const workerKey = isWorkerApiKey(key.id);
  if (workerKey && !workerRoute) {
    return forbidden('worker_key', 'A worker key can only reach the worker routes.');
  }
  if (!workerKey && workerRoute) {
    return forbidden('not_a_worker', 'Only an enrolled worker can reach this route.');
  }
  const worker = workerKey ? getWorkerDevice(key.id) : null;
  if (workerKey && !worker) return unauthorized();

  // Tell handlers which key this is. Set after removing any the caller sent,
  // so they can be trusted (src/lib/auth/request-key.ts).
  const headers = new Headers(request.headers);
  for (const h of FORWARDED_KEY_HEADERS) headers.delete(h);
  headers.set(API_KEY_ID_HEADER, key.id);
  headers.set(CALLER_LOCATION_HEADER, isHostKeyHash(tokenHash) ? 'home' : 'elsewhere');
  headers.set(API_KEY_SCOPE_HEADER, workerKey ? 'worker' : 'viewer');
  if (worker) headers.set(WORKER_DEVICE_HEADER, worker.id);
  return NextResponse.next({ request: { headers } });
}
