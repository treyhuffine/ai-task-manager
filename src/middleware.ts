import { NextResponse, type NextRequest } from 'next/server';
import { hashToken } from '@/lib/auth/tokens';
import { findApiKeyByHash, touchApiKey } from '@/lib/db/queries';

export const config = {
  runtime: 'nodejs',
  matcher: ['/api/:path*'],
};

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

// Paths that bypass auth. `/api/health` is our cross-origin reachability
// probe used by the CLI and the web UI's "Test connection" button. It only
// returns { ok, app, port } — nothing sensitive — so it's safe to leave
// unauthenticated, and CORS on the route handler lets browsers read it.
const PUBLIC_PATHS = new Set<string>(['/api/health']);

export function middleware(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const header = request.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return unauthorized();
  }

  const token = header.slice(7).trim();
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
