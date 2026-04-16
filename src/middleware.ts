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

export function middleware(request: NextRequest) {
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
