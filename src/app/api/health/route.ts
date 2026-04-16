/**
 * Health probe.
 *
 * The CLI hits this with the pairing token to confirm that (a) the server is
 * up and (b) it's *our* app on this port, not some unrelated process.
 * Auth is enforced by the global middleware at `src/middleware.ts`.
 */

import { NextResponse } from 'next/server';
import { APP_SHORT_ID } from '@/constants/app';
import { getRunningPort } from '@/lib/auth/port';

export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json({
    ok: true,
    app: APP_SHORT_ID,
    port: getRunningPort(),
  });
}
