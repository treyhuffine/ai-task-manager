import {
  discoverExternalAgentSessions,
  importExternalAgentSessions,
} from '@/lib/import/external-agents';
import { discoverRemoteSessions, importRemoteSessions } from '@/lib/import/remote';
import type { ExternalAgentImportRequest } from '@/lib/import/types';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { WorkerUnavailableError } from '@/lib/workers/hub';
import { z as rpcZ } from 'zod/v4';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

/**
 * `?deviceId=` lists a connected device's sessions through its worker
 * (docs/homes-build.md, P2.9). Without it, the home's own.
 */
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const deviceId = searchParams(rpcInput.query).get('deviceId');
    return reply(deviceId ? await discoverRemoteSessions(deviceId) : await discoverExternalAgentSessions());
  } catch (error) {
    if (error instanceof WorkerUnavailableError) {
      return reply({ error: 'unavailable', message: error.message }, { status: 409 });
    }
    console.error('[GET /api/imports/agents]', error);
    return reply({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const body = rpcInput.body as Partial<ExternalAgentImportRequest>;
    if (!Array.isArray(body.sessionKeys) || !body.sessionKeys.every((key) => typeof key === 'string')) {
      return reply({ error: 'sessionKeys must be an array of strings' }, { status: 400 });
    }
    const deviceId = typeof body.deviceId === 'string' && body.deviceId ? body.deviceId : null;
    return reply(
      deviceId ? await importRemoteSessions(deviceId, body.sessionKeys) : await importExternalAgentSessions(body.sessionKeys),
    );
  } catch (error) {
    if (error instanceof WorkerUnavailableError) {
      return reply({ error: 'unavailable', message: error.message }, { status: 409 });
    }
    console.error('[POST /api/imports/agents]', error);
    return reply({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "deviceId": rpcZ.string().optional() }).strict().optional() }).strict().default({});
export const POSTInput = rpcZ.object({ body: rpcZ.object({ "sessionKeys": rpcZ.array(rpcZ.string()).optional(), "deviceId": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional() }).strict().default({}) }).strict();
