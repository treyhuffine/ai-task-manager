/**
 * GET /api/agents — list agents (orchestrator + executor). Used by the
 * trigger creation form's agent dropdown.
 */

import { NextRequest } from 'next/server';
import { listAgents } from '@/lib/db/queries';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status');
    const rows = listAgents({
      status: status === 'archived' ? 'archived' : 'active',
    });
    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/agents]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
