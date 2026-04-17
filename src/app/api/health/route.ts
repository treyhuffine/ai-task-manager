/**
 * Health + reachability probe. Public, CORS-enabled.
 *
 * Used by:
 *   • CLI `probeHealth` — confirms our app is the thing listening on a port
 *     so `flow pair` / `flow start` don't print URLs for a foreign process.
 *   • Web UI "Test connection" — called cross-origin on the user's remote
 *     base URL to confirm it routes back to a flow server.
 *
 * Response body is intentionally minimal ({ ok, app, port }) — nothing an
 * unauthenticated caller couldn't infer from a 401 or port scan, so it's
 * safe to expose without auth. Auth bypass is wired in `src/middleware.ts`.
 */

import { NextResponse } from 'next/server';
import { APP_SHORT_ID } from '@/constants/app';
import { getRunningPort } from '@/lib/auth/port';

export const runtime = 'nodejs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store',
} as const;

export function GET() {
  return NextResponse.json(
    { ok: true, app: APP_SHORT_ID, port: getRunningPort() },
    { headers: CORS_HEADERS },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
