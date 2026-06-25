import { NextResponse, type NextRequest } from 'next/server';
import { hashToken } from '@/lib/auth/tokens';
import { findApiKeyByHash, touchApiKey } from '@/lib/db/queries';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

export const config = {
  matcher: ['/api/:path*'],
};

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
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

export function proxy(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith('/api/webhooks/')) {
    return NextResponse.next();
  }

  // `/api/connectors/callback` is the OAuth redirect target. The provider
  // (Google, etc.) sends the user's browser here with `?code&state`; that
  // navigation cannot carry the app's Bearer token. The handler's own security
  // is the single-use, unguessable `state` it validates against the stored
  // AuthRequest — a strictly weaker, single-purpose credential. Exempted so the
  // round-trip completes.
  if (request.nextUrl.pathname === '/api/connectors/callback') {
    return NextResponse.next();
  }

  // `/api/connectors/mcp-oauth/<sid>` is the OAuth redirect target for an ingested MCP server.
  // Same rationale as the connectors callback: the provider redirects the user's browser here
  // without the app Bearer; the SDK's single-use authorization code + PKCE verifier are the auth.
  if (request.nextUrl.pathname.startsWith('/api/connectors/mcp-oauth/')) {
    return NextResponse.next();
  }

  // `/api/triggers/<publicId>` is the webhook intake for schedules. The
  // path's publicId is the identity; HMAC-SHA256 over the raw body
  // (verified inside the route against `schedules.webhookSecretHash`)
  // is the auth. See task #16.
  if (request.nextUrl.pathname.startsWith('/api/triggers/')) {
    return NextResponse.next();
  }

  // `/api/takeover/<token>/...` is the CLI surface for "Take over locally."
  // The `token` in the path IS the auth — handlers validate it against
  // `chat_sessions.takeoverToken` and its `_expires_at`. Tokens are
  // single-purpose, scoped to one session, and rotate on every new
  // takeover so they're a strictly weaker credential than the bearer
  // key. Exempted here so the CLI can reach the endpoints without
  // needing the user's long-lived account token.
  if (request.nextUrl.pathname.startsWith('/api/takeover/')) {
    return NextResponse.next();
  }

  const token = extractToken(request);
  if (!token) return unauthorized();

  const key = findApiKeyByHash(hashToken(token));
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

  return NextResponse.next();
}
