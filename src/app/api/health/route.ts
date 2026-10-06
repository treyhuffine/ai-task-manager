/**
 * Health + reachability probe. Public, CORS-enabled.
 *
 * Used by:
 *   • CLI `probeHealth` — confirms our app is the thing listening on a port
 *     so `ri pair` / `ri start` don't print URLs for a foreign process.
 *   • Web UI "Test connection" — called cross-origin on the user's remote
 *     base URL to confirm it routes back to a Ri server.
 *
 * Response body is intentionally minimal ({ ok, app, port }) — nothing an
 * unauthenticated caller couldn't infer from a 401 or port scan, so it's
 * safe to expose without auth. Auth bypass is wired in `src/middleware.ts`.
 */

import { NextResponse } from 'next/server';
import { APP_SHORT_ID } from '@/constants/app';
import { getRunningPort } from '@/lib/auth/port';
import { hasWebSocketRuntime } from '@/lib/trpc/ws-runtime';

export const runtime = 'nodejs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store',
} as const;

export function GET() {
  // Next initializes instrumentation on the first production request. Check
  // here after that initialization, so launchers cannot accept an HTTP-only
  // build as a healthy terminal host. Native Next and explicit WS disable
  // still support their intentional HTTP-only mode.
  const ready = process.env.RI_TRPC_WS_HOST !== '1'
    || process.env.RI_TRPC_WS_DISABLED === '1'
    || hasWebSocketRuntime();
  return NextResponse.json(
    { ok: ready, app: APP_SHORT_ID, port: getRunningPort(), ...(!ready && { error: 'websocket_unavailable' }) },
    { status: ready ? 200 : 503, headers: CORS_HEADERS },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
