import { NextResponse, type NextRequest } from 'next/server';
import { hashToken } from '@/lib/auth/tokens';
import { findApiKeyByHash, getWorkerEnrollment, isWorkerApiKey, touchApiKey } from '@/lib/db/queries';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { isHomeActive } from '@/lib/home/identity';
import {
  API_KEY_ID_HEADER,
  API_KEY_SCOPE_HEADER,
  API_KEY_TYPE_HEADER,
  CALLER_LOCATION_HEADER,
  FORWARDED_KEY_HEADERS,
  WORKER_COMPUTER_HEADER,
} from '@/lib/auth/request-key';
import { isHostKeyHash } from '@/lib/auth/host-key';

export const config = {
  matcher: ['/api/:path*'],
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

export function proxy(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return nextWithoutKeyHeaders(request);
  }

  // A root whose data came from another computer serves nothing until it is
  // claimed, so two copies never act as one home (docs/homes-spec.md §10.3).
  // Checked before the routes that carry their own credentials (webhooks,
  // OAuth callbacks, takeover), since those can start work too.
  if (!isHomeActive()) {
    return NextResponse.json(
      {
        error: 'home_not_active',
        message: 'This copy of your home is not active on this computer. Run `ri home claim` here if it should be.',
      },
      { status: 503 },
    );
  }

  if (request.nextUrl.pathname.startsWith('/api/webhooks/')) {
    return nextWithoutKeyHeaders(request);
  }

  // `/api/connectors/callback` is the OAuth redirect target. The provider
  // (Google, etc.) sends the user's browser here with `?code&state`; that
  // navigation cannot carry the app's Bearer token. The handler's own security
  // is the single-use, unguessable `state` it validates against the stored
  // AuthRequest — a strictly weaker, single-purpose credential. Exempted so the
  // round-trip completes.
  if (request.nextUrl.pathname === '/api/connectors/callback') {
    return nextWithoutKeyHeaders(request);
  }

  // `/api/connectors/mcp-oauth/<sid>` is the OAuth redirect target for an ingested MCP server.
  // Same rationale as the connectors callback: the provider redirects the user's browser here
  // without the app Bearer; the SDK's single-use authorization code + PKCE verifier are the auth.
  if (request.nextUrl.pathname.startsWith('/api/connectors/mcp-oauth/')) {
    return nextWithoutKeyHeaders(request);
  }

  // `/api/takeover/<token>/...` is the CLI surface for "Take over locally."
  // The `token` in the path IS the auth — handlers validate it against
  // `chat_sessions.takeoverToken` and its `_expires_at`. Tokens are
  // single-purpose, scoped to one session, and rotate on every new
  // takeover so they're a strictly weaker credential than the bearer
  // key. Exempted here so the CLI can reach the endpoints without
  // needing the user's long-lived account token.
  if (request.nextUrl.pathname.startsWith('/api/takeover/')) {
    return nextWithoutKeyHeaders(request);
  }

  // Redeeming an enroll grant is how a computer gets its first worker key, so
  // the grant in the body is the credential: short-lived, single-use, and
  // issued by an owner (docs/homes-build.md, P2.2).
  if (request.nextUrl.pathname === '/api/workers/enroll') {
    return nextWithoutKeyHeaders(request);
  }

  const token = extractToken(request);
  if (!token) return unauthorized();


  const tokenHash = hashToken(token);
  const key = findApiKeyByHash(tokenHash);
  if (!key || key.revokedAt) return unauthorized();

  if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
    return unauthorized();
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
  const worker = workerKey ? getWorkerEnrollment(key.id) : null;
  if (workerKey && !worker) return unauthorized();

  // Tell handlers which key this is. Set after removing any the caller sent,
  // so they can be trusted (src/lib/auth/request-key.ts).
  const headers = new Headers(request.headers);
  for (const h of FORWARDED_KEY_HEADERS) headers.delete(h);
  headers.set(API_KEY_ID_HEADER, key.id);
  headers.set(API_KEY_TYPE_HEADER, key.deviceType);
  headers.set(CALLER_LOCATION_HEADER, isHostKeyHash(tokenHash) ? 'home' : 'elsewhere');
  headers.set(API_KEY_SCOPE_HEADER, workerKey ? 'worker' : 'viewer');
  if (worker) headers.set(WORKER_COMPUTER_HEADER, worker.computer.id);
  return NextResponse.next({ request: { headers } });
}
