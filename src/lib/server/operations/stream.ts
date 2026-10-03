import type { CreateStreamInput, StreamStatus } from '@/db/types';
import { createStream, listStreamWithOutcomes } from '@/lib/db/queries';
import { stream } from '@/lib/db/schema';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { onStreamCaptured } from '@/lib/stream-triage/triggers';
import { createInsertSchema } from 'drizzle-zod';
import { z as rpcZ } from 'zod/v4';

// Compressed: this route can ship hundreds of KB of JSON, and Next 16
// does not compress route handlers. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const params = searchParams(rpcInput.query);
    const status = params.get('status');
    const rows = listStreamWithOutcomes({
      status: status ? (status.split(',') as StreamStatus[]) : undefined,
      limit: params.get('limit') ? parseInt(params.get('limit')!, 10) : undefined,
      offset: params.get('offset') ? parseInt(params.get('offset')!, 10) : undefined,
    });
    return reply(rows);
  } catch (err) {
    console.error('[GET /api/stream]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const body: CreateStreamInput = rpcInput.body;

    if (!body.rawText) {
      return reply({ error: 'rawText is required' }, { status: 400 });
    }

    const row = createStream(body);
    onStreamCaptured(row.id);
    return reply(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/stream]', err);
    return reply({ error: String(err) }, { status: 400 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "status": rpcZ.string().optional(), "limit": rpcZ.string().optional(), "offset": rpcZ.string().optional() }).strict().optional() }).strict().default({});
export const POSTInput = rpcZ.object({ body: createInsertSchema(stream).pick({ "status": true, "createdAt": true, "updatedAt": true, "source": true, "rawText": true, "media": true, "origin": true, "externalSource": true, "externalId": true, "externalPayload": true, "dismissedBy": true, "resurfaceAt": true }).partial().extend({ "rawText": createInsertSchema(stream).shape.rawText, "attachments": rpcZ.union([rpcZ.null(), rpcZ.array(rpcZ.object({ "fileName": rpcZ.string(), "originalName": rpcZ.string(), "mimeType": rpcZ.string(), "size": rpcZ.number().finite(), "uploadedAt": rpcZ.string() }).strict())]).optional() }).strict() }).strict();
