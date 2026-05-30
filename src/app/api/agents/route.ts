/**
 * GET /api/agents — list agents (orchestrator + executor). Used by the
 * schedule creation form's agent dropdown.
 */

import { NextRequest } from 'next/server';
import { listAgents } from '@/lib/db/queries';

export async function GET(request: NextRequest) {
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
