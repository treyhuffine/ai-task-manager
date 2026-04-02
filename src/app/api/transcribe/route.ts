import { NextRequest } from 'next/server';

const LOCAL_STT_URL = process.env.LOCAL_SPEECH_TO_TEXT_URL ?? 'http://localhost:5092';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ─── Provider health checks ─────────────────────────────────

async function isLocalAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_STT_URL}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Provider transcription handlers ─────────────────────────

async function transcribeLocal(file: Blob, modelName: string): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('response_format', 'json');
  form.append('model', modelName);

  const res = await fetch(`${LOCAL_STT_URL}/v1/audio/transcriptions`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Local STT error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.text ?? '';
}

async function transcribeGroq(file: Blob, modelName: string): Promise<string> {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');

  const form = new FormData();
  form.append('file', file);
  form.append('model', modelName);
  form.append('response_format', 'json');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.text ?? '';
}

async function transcribeOpenAI(file: Blob, modelName: string): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

  const form = new FormData();
  form.append('file', file);
  form.append('model', modelName);
  form.append('response_format', 'json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.text ?? '';
}

// ─── Routes ──────────────────────────────────────────────────

/**
 * POST /api/transcribe
 * Proxies audio to the configured STT provider.
 * Expects multipart/form-data with `file` (audio blob) and optional `voice_model` (provider/model string).
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as Blob | null;
    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    const voiceModel = (formData.get('voice_model') as string) || 'local/parakeet-tdt-0.6b-v3';
    const slashIdx = voiceModel.indexOf('/');
    const provider = slashIdx > -1 ? voiceModel.slice(0, slashIdx) : 'local';
    const modelName = slashIdx > -1 ? voiceModel.slice(slashIdx + 1) : voiceModel;

    let text: string;

    switch (provider) {
      case 'local': {
        const available = await isLocalAvailable();
        if (!available) {
          return Response.json(
            {
              error: 'Local speech-to-text server is not available. Run: pnpm dev:stt',
              available: false,
            },
            { status: 503 },
          );
        }
        text = await transcribeLocal(file, modelName);
        break;
      }
      case 'groq':
        text = await transcribeGroq(file, modelName);
        break;
      case 'openai':
        text = await transcribeOpenAI(file, modelName);
        break;
      case 'web':
        // Web Speech API is handled client-side, should never hit this route
        return Response.json(
          { error: 'Web speech recognition is handled in the browser' },
          { status: 400 },
        );
      default:
        return Response.json({ error: `Unknown voice provider: ${provider}` }, { status: 400 });
    }

    return Response.json({ text, provider });
  } catch (err) {
    console.error('[POST /api/transcribe]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * GET /api/transcribe
 * Returns availability status for each provider.
 */
export async function GET() {
  const localAvailable = await isLocalAvailable();
  return Response.json({
    providers: {
      local: { available: localAvailable, configured: true },
      groq: { available: !!GROQ_API_KEY, configured: !!GROQ_API_KEY },
      openai: { available: !!OPENAI_API_KEY, configured: !!OPENAI_API_KEY },
      web: { available: true, configured: true },
    },
  });
}
