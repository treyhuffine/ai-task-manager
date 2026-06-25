import { NextRequest } from 'next/server';

const LOCAL_STT_URL = process.env.LOCAL_SPEECH_TO_TEXT_URL ?? 'http://localhost:5092';

// 2 min timeout — loading a new model variant can take 30s+ on first run
const TIMEOUT_MS = 120_000;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as Blob | null;
    const model = (formData.get('model') as string) || 'parakeet-tdt-0.6b-v3';

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    const form = new FormData();
    form.append('file', file);
    form.append('model', model);
    form.append('response_format', 'json');

    const start = performance.now();
    const res = await fetch(`${LOCAL_STT_URL}/v1/audio/transcriptions`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const latencyMs = Math.round(performance.now() - start);

    if (!res.ok) {
      const body = await res.text();
      return Response.json({ error: `STT error ${res.status}: ${body}` }, { status: 502 });
    }

    const data = await res.json();
    return Response.json({ text: data.text ?? '', model, latencyMs });
  } catch (err) {
    console.error('[POST /api/stt-bench]', err);

    const msg = String(err);
    // Detect sidecar crash / connection reset
    if (msg.includes('SocketError') || msg.includes('other side closed') || msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      return Response.json(
        { error: `Sidecar crashed or connection lost, likely OOM loading model. Check Docker logs.` },
        { status: 502 },
      );
    }
    if (msg.includes('TimeoutError') || msg.includes('abort')) {
      return Response.json({ error: `Request timed out after ${TIMEOUT_MS / 1000}s` }, { status: 504 });
    }

    return Response.json({ error: msg }, { status: 500 });
  }
}
