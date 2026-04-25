/**
 * Browser session endpoint.
 *
 *   POST   — set the session cookie from the already-authenticated request.
 *            Callers prove they have a valid token by getting past middleware;
 *            we just mirror that token into an httpOnly cookie so subsequent
 *            browser-native loads (`<img>`, `<audio>`, `EventSource`) can
 *            authenticate without the client attaching headers.
 *   DELETE — clear the session cookie. Bearer transport keeps working.
 *
 * Not a new trust boundary. The middleware still validates on every request.
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildExpiredSessionCookie, buildSessionCookie } from '@/lib/auth/session';
import { hashToken } from '@/lib/auth/tokens';
import { findApiKeyByHash } from '@/lib/db/queries';

function isSecureRequest(request: NextRequest): boolean {
  if (request.nextUrl.protocol === 'https:') return true;
  // Trust the edge proxy's hint when present — `x-forwarded-proto` is the
  // canonical signal. Lets us ship `secure` cookies behind an https tunnel
  // even though the node process itself is plain http.
  const fwd = request.headers.get('x-forwarded-proto');
  return fwd?.split(',')[0].trim().toLowerCase() === 'https';
}

export async function POST(request: NextRequest) {
  // Public route (see PUBLIC_PATHS in middleware), so we validate the token
  // here ourselves rather than relying on the edge guard. Same hash lookup
  // the middleware uses — just without the touch-on-use side effect.
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'bearer required' }, { status: 401 });
  }
  const token = header.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: 'empty token' }, { status: 401 });
  }
  const key = findApiKeyByHash(hashToken(token));
  if (!key || key.revoked_at) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 });
  }
  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    return NextResponse.json({ error: 'expired token' }, { status: 401 });
  }

  const cookie = buildSessionCookie(token, isSecureRequest(request));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookie);
  return res;
}

export async function DELETE(request: NextRequest) {
  const cookie = buildExpiredSessionCookie(isSecureRequest(request));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookie);
  return res;
}
