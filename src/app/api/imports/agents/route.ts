import type { NextRequest } from 'next/server';
import {
  discoverExternalAgentSessions,
  importExternalAgentSessions,
} from '@/lib/import/external-agents';
import type { ExternalAgentImportRequest } from '@/lib/import/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(await discoverExternalAgentSessions());
  } catch (error) {
    console.error('[GET /api/imports/agents]', error);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Partial<ExternalAgentImportRequest>;
    if (!Array.isArray(body.sessionKeys) || !body.sessionKeys.every((key) => typeof key === 'string')) {
      return Response.json({ error: 'sessionKeys must be an array of strings' }, { status: 400 });
    }
    return Response.json(await importExternalAgentSessions(body.sessionKeys));
  } catch (error) {
    console.error('[POST /api/imports/agents]', error);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
