import { listTriageDecisions, listTriagePasses } from '@/lib/db/queries';
import { failureResponse, reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { triageErrorResponse } from '@/lib/stream-triage/http';
import { serializeDecision } from '@/lib/stream-triage/serialize';
import { z as rpcZ } from 'zod/v4';

/** GET /api/stream/passes — digest data: recent passes with their
 *  decisions and source-capture previews. */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const params = searchParams(rpcInput.query);
    const passes = listTriagePasses({
      limit: params.get('limit') ? parseInt(params.get('limit')!, 10) : 10,
    });
    const withDecisions = passes.map((pass) => ({
      ...pass,
      decisions: listTriageDecisions({ passId: pass.id }).map(serializeDecision),
    }));
    return reply(withDecisions);
  } catch (err) {
    return failureResponse(triageErrorResponse('GET /api/stream/passes', err));
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "limit": rpcZ.string().optional() }).strict().optional() }).strict().default({});
