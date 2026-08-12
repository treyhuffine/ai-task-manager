import type { NextRequest } from 'next/server';
import {
  discoverExternalAgentSessions,
  importExternalAgentSessions,
} from '@/lib/import/external-agents';
import type { ExternalAgentImportRequest } from '@/lib/import/types';
import { withCompression } from '@/lib/api/compression';

export const dynamic = 'force-dynamic';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
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
