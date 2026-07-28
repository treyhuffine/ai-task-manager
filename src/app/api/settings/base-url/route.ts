/**
 * Pair base URLs.
 *
 *   GET     → BaseUrlSnapshot          // server-side-known base URLs
 *   PATCH   { baseUrl } → same shape   // set/clear the tunnel URL
 *   DELETE  → clears tunnel URL
 *
 * `tunnel` is user-configured and persisted to ~/<APP_SHORT_ID>/config.json.
 * `lan` is auto-detected from the first non-loopback IPv4 interface.
 * `local` is `http://localhost:<running port>`.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { setRemoteBaseUrl, clearRemoteBaseUrl } from '@/lib/auth/bootstrap';
import { baseUrlSnapshot as snapshot } from '@/lib/auth/base-url-snapshot';

export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json(snapshot());
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as { baseUrl?: string | null };
    if (body.baseUrl === null || body.baseUrl === '') {
      clearRemoteBaseUrl();
    } else if (typeof body.baseUrl === 'string') {
      setRemoteBaseUrl(body.baseUrl);
    } else {
      return NextResponse.json({ error: 'baseUrl must be a string or null' }, { status: 400 });
    }
    return NextResponse.json(snapshot());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export function DELETE() {
  clearRemoteBaseUrl();
  return NextResponse.json(snapshot());
}
