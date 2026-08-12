import { NextRequest } from 'next/server';
import { listTriagePasses, listTriageDecisions } from '@/lib/db/queries';
import { triageErrorResponse } from '@/lib/stream-triage/http';
import { serializeDecision } from '@/lib/stream-triage/serialize';
import { withCompression } from '@/lib/api/compression';

/** GET /api/stream/passes — digest data: recent passes with their
 *  decisions and source-capture previews. */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const passes = listTriagePasses({
      limit: params.get('limit') ? parseInt(params.get('limit')!, 10) : 10,
    });
    const withDecisions = passes.map((pass) => ({
      ...pass,
      decisions: listTriageDecisions({ passId: pass.id }).map(serializeDecision),
    }));
    return Response.json(withDecisions);
  } catch (err) {
    return triageErrorResponse('GET /api/stream/passes', err);
  }
}
