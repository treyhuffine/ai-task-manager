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

  const token = extractToken(request);
  if (!token) return unauthorized();

  const key = findApiKeyByHash(hashToken(token));
  if (!key || key.revoked_at) return unauthorized();

  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    return unauthorized();
  }

  try {
    touchApiKey(key.id, {
      ip: request.headers.get('x-forwarded-for') ?? null,
      user_agent: request.headers.get('user-agent') ?? null,
    });
  } catch (err) {
    console.error('[auth] touchApiKey failed:', err);
  }

  return NextResponse.next();
}
