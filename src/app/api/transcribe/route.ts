import { withCompression } from '@/lib/api/compression';
import { readLimitedFormData, RequestBodyTooLargeError } from '@/lib/api/limited-body';
import { operationContext, operationResponse } from '@/lib/server/operation';
import * as providerStatus from '@/lib/server/operations/transcribe';
import { transcribe } from '@/lib/stt/transcribe';
import { NextRequest } from 'next/server';

/**
 * POST /api/transcribe
 * Proxies audio to the configured STT provider.
 * Expects multipart/form-data with `file` (audio blob) and optional `voiceModel`.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await readLimitedFormData(request);
    const file = formData.get('file') as Blob | null;
    if (!(file instanceof Blob) || file.size === 0) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    const voiceModel = (formData.get('voiceModel') as string) || 'local/parakeet-tdt-0.6b-v3';
    const text = await transcribe(file, voiceModel, request.signal);

    const provider = voiceModel.split('/')[0];
    return Response.json({ text, provider });
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) return Response.json({ error: err.message }, { status: 413 });
    console.error('[POST /api/transcribe]', err);
    const message = err instanceof Error ? err.message : String(err);

    // Surface specific provider errors as 503
    if (message.includes('unavailable') || message.includes('not configured')) {
      return Response.json({ error: message, available: false }, { status: 503 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/transcribe
 * Returns availability status for each provider.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  return operationResponse(await providerStatus.GET({}, operationContext(new Request('http://localhost/api/transcribe'), {}, '/transcribe')));
}
