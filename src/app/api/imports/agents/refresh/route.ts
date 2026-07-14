import type { NextRequest } from 'next/server';
import { refreshExternalAgentSessions } from '@/lib/import/external-agents';
import type { ExternalAgentRefreshRequest } from '@/lib/import/types';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Partial<ExternalAgentRefreshRequest>;
    if (!Array.isArray(body.chatSessionIds)
      || !body.chatSessionIds.every((id) => typeof id === 'string')) {
      return Response.json({ error: 'chatSessionIds must be an array of strings' }, { status: 400 });
    }
    return Response.json(await refreshExternalAgentSessions(body.chatSessionIds));
  } catch (error) {
    console.error('[POST /api/imports/agents/refresh]', error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
