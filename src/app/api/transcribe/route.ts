import { NextRequest } from 'next/server';
import { transcribe, getProviderStatus } from '@/lib/stt/transcribe';

/**
 * POST /api/transcribe
 * Proxies audio to the configured STT provider.
 * Expects multipart/form-data with `file` (audio blob) and optional `voiceModel`.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as Blob | null;
    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    const voiceModel = (formData.get('voiceModel') as string) || 'local/parakeet-tdt-0.6b-v3';
    const text = await transcribe(file, voiceModel);

    const provider = voiceModel.split('/')[0];
    return Response.json({ text, provider });
  } catch (err) {
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
export async function GET() {
  return Response.json({ providers: await getProviderStatus() });
}
