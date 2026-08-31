/**
 * POST /api/webhooks/pocket
 *
 * Ingests Pocket (HeyPocket) webhook deliveries. Currently we only promote
 * recordings into the stream on `transcription.completed` — that's the
 * earliest event that carries usable transcript text. All other events are
 * acknowledged with 200 so Pocket doesn't retry.
 *
 * Auth: query-string shared secret (`?secret=...`) matched against
 * `POCKET_WEBHOOK_SECRET`. If the env var is unset, the route refuses all
 * requests rather than silently running open. Pocket's docs mention an
 * HMAC-SHA256 option but the UI doesn't expose it yet — swap in header-based
 * verification once they ship it.
 *
 * Dedup: Pocket delivers at-least-once with retries. We key on `recording.id`
 * via `externalSource='pocket'` + `externalId`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createExternalStream, findStreamByExternalId } from '@/lib/db/queries';
import { onStreamCaptured } from '@/lib/stream-triage/triggers';

export const runtime = 'nodejs';

const EXPECTED_USER_AGENT = 'HeyPocket-Webhook/1.0';

interface PocketTranscriptSegment {
  text?: string;
  speaker?: string;
  start?: number;
  end?: number;
}

interface PocketPayload {
  event?: string;
  timestamp?: string;
  recording?: {
    id?: string;
    title?: string;
    description?: string;
    duration?: number;
    language?: string;
    createdAt?: string;
  };
  transcript?: PocketTranscriptSegment[];
}

function formatTranscript(payload: PocketPayload): string {
  const segments = payload.transcript ?? [];
  if (segments.length === 0) return '';

  // Group consecutive segments by speaker so the result reads like a dialog
  // rather than a token-by-token dump.
  const lines: string[] = [];
  let currentSpeaker: string | undefined;
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim();
    lines.push(currentSpeaker ? `**${currentSpeaker}:** ${text}` : text);
    buffer = [];
  };

  for (const seg of segments) {
    const text = (seg.text ?? '').trim();
    if (!text) continue;
    if (seg.speaker !== currentSpeaker) {
      flush();
      currentSpeaker = seg.speaker;
    }
    buffer.push(text);
  }
  flush();

  return lines.join('\n\n').trim();
}

export async function POST(request: NextRequest) {
  const secret = process.env.POCKET_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[POST /api/webhooks/pocket] POCKET_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 });
  }

  const providedSecret = request.nextUrl.searchParams.get('secret');
  if (providedSecret !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (request.headers.get('user-agent') !== EXPECTED_USER_AGENT) {
    // Not a security boundary — just filters stray probes from noise.
    return NextResponse.json({ error: 'unexpected user-agent' }, { status: 400 });
  }

  const bodyText = await request.text();
  let payload: PocketPayload;
  try {
    payload = JSON.parse(bodyText) as PocketPayload;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const event = payload.event;
  const recordingId = payload.recording?.id;

  // Only `transcription.completed` carries transcript text worth capturing.
  // Other events (summary, mind map, action items) don't add a new stream
  // item — we ack them so Pocket stops retrying.
  if (event !== 'transcription.completed') {
    return NextResponse.json({ ok: true, skipped: event ?? 'unknown' });
  }

  if (!recordingId) {
    return NextResponse.json({ error: 'missing recording.id' }, { status: 400 });
  }

  const existing = findStreamByExternalId('pocket', recordingId);
  if (existing) {
    return NextResponse.json({ ok: true, deduped: true, item_id: existing.id });
  }

  const transcript = formatTranscript(payload);
  if (!transcript) {
    return NextResponse.json({ error: 'empty transcript' }, { status: 400 });
  }

  const inserted = createExternalStream({
    rawText: transcript,
    source: 'webhook',
    media: 'voice',
    origin: 'webhook',
    externalSource: 'pocket',
    externalId: recordingId,
    externalPayload: bodyText,
    status: 'pending',
  });
  if (!inserted.created) {
    return NextResponse.json({
      ok: true,
      deduped: true,
      item_id: inserted.row.id,
    });
  }

  onStreamCaptured(inserted.row.id);

  return NextResponse.json({ ok: true, item_id: inserted.row.id }, { status: 201 });
}
