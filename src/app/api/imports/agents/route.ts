import type { NextRequest } from 'next/server';
import {
  discoverExternalAgentSessions,
  importExternalAgentSessions,
} from '@/lib/import/external-agents';
import { discoverRemoteSessions, importRemoteSessions } from '@/lib/import/remote';
import type { ExternalAgentImportRequest } from '@/lib/import/types';
import { WorkerUnavailableError } from '@/lib/workers/hub';
import { withCompression } from '@/lib/api/compression';

export const dynamic = 'force-dynamic';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

/**
 * `?deviceId=` lists a connected device's sessions through its worker
 * (docs/homes-build.md, P2.9). Without it, the home's own.
 */
async function handleGET(request: NextRequest) {
  try {
    const deviceId = request.nextUrl.searchParams.get('deviceId');
    return Response.json(deviceId ? await discoverRemoteSessions(deviceId) : await discoverExternalAgentSessions());
  } catch (error) {
    if (error instanceof WorkerUnavailableError) {
      return Response.json({ error: 'unavailable', message: error.message }, { status: 409 });
    }
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
    const deviceId = typeof body.deviceId === 'string' && body.deviceId ? body.deviceId : null;
    return Response.json(
      deviceId ? await importRemoteSessions(deviceId, body.sessionKeys) : await importExternalAgentSessions(body.sessionKeys),
    );
  } catch (error) {
    if (error instanceof WorkerUnavailableError) {
      return Response.json({ error: 'unavailable', message: error.message }, { status: 409 });
    }
    console.error('[POST /api/imports/agents]', error);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
