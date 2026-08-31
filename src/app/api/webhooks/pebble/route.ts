/**
 * POST /api/webhooks/pebble
 *
 * Ingests Pebble Index 01 recording webhooks into the Stream. The Pebble
 * mobile app sends multipart/form-data with a required capture timestamp,
 * optional transcription, and optional M4A recording.
 *
 * Auth: a static secret configured in `PEBBLE_WEBHOOK_SECRET`, sent as either
 * `X-Pebble-Webhook-Secret` or `Authorization: Bearer <secret>`. This route is
 * exempt from the app-wide bearer middleware, so it must fail closed here.
 *
 * Dedup: Index payloads do not include a standalone event id. `recordedAt` is
 * always present and belongs to the original recording, including redelivery,
 * so it is the stable upstream id for this adapter.
 */

import { timingSafeEqual } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { after, NextRequest } from 'next/server';
import {
  createExternalStream,
  findStreamByExternalId,
  getUserState,
  updateStream,
} from '@/lib/db/queries';
import { attachmentPath, saveAttachment } from '@/lib/attachments/save';
import { resolveMime } from '@/lib/attachments/mime';
import { pickProvider, transcribe } from '@/lib/stt/transcribe';
import { onStreamCaptured } from '@/lib/stream-triage/triggers';
import {
  readLimitedRequestBody,
  RequestBodyTooLargeError,
} from '@/lib/webhooks/read-limited-body';
import type { Attachment, StreamRecord } from '@/db/types';

export const runtime = 'nodejs';

const EXTERNAL_SOURCE = 'pebble-index-01';
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_AUDIO_BYTES + 1024 * 1024;
const MAX_TRANSCRIPTION_CHARS = 200_000;
const SERVER_TRANSCRIPTION_TIMEOUT_MS = 90_000;
const LOG_PREFIX = '[POST /api/webhooks/pebble]';
const ALLOWED_TRIGGERS = new Set([
  'single-click-hold',
  'double-click-hold',
  'test-event',
]);

type TranscriptionSource = 'pebble' | 'flow' | null;

interface PebbleRecording {
  recordedAt: number;
  client: 'ring';
  trigger: string;
  pebbleTranscription: string | null;
  audio: Blob | null;
}

/** Serializes redeliveries for one recording inside a server process. */
const inFlightRecordings = new Map<string, Promise<Response>>();

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

function logPebble(event: string, details: Record<string, unknown>): void {
  console.info(`${LOG_PREFIX} ${event}`, JSON.stringify(details));
}

function rejectPebble(
  error: string,
  status: number,
  details: Record<string, unknown> = {},
): Response {
  console.warn(
    `${LOG_PREFIX} request rejected`,
    JSON.stringify({ status, error, ...details }),
  );
  return jsonError(error, status);
}

function requestSummary(request: NextRequest): Record<string, unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  return {
    contentType: contentType.split(';', 1)[0]?.trim().toLowerCase() || null,
    contentLength: request.headers.get('content-length'),
    trigger: request.headers.get('x-index-trigger')?.trim() || null,
    indexTest: request.headers.get('x-index-test')?.toLowerCase() === 'true',
    userAgent: request.headers.get('user-agent'),
  };
}

function formFieldNames(formData: FormData): string[] {
  return [...new Set(formData.keys())].sort();
}

function providedSecret(request: NextRequest): string | null {
  const dedicated = request.headers.get('x-pebble-webhook-secret')?.trim();
  if (dedicated) return dedicated;

  const authorization = request.headers.get('authorization');
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const providedBytes = Buffer.from(provided, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes);
}

function formString(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' ? value : null;
}

function parseRecordedAt(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return Number.isNaN(new Date(parsed).getTime()) ? null : parsed;
}

function safeAudioName(audio: Blob, recordedAt: number): string {
  const supplied = typeof (audio as File).name === 'string'
    ? (audio as File).name.trim()
    : '';
  return /^[A-Za-z0-9._-]+\.m4a$/i.test(supplied)
    ? supplied
    : `index-${recordedAt}.m4a`;
}

function attachmentReference(attachment: Attachment): string {
  return `[${attachment.originalName}](/api/attachments/${attachment.fileName})`;
}

async function tryServerTranscription(audio: Blob): Promise<string | null> {
  let voiceModel = getUserState()?.voiceModel ?? null;
  if (!voiceModel) {
    try {
      voiceModel = await pickProvider();
    } catch {
      return null;
    }
  }

  try {
    const result = await transcribe(
      audio,
      voiceModel,
      AbortSignal.timeout(SERVER_TRANSCRIPTION_TIMEOUT_MS),
    );
    return result.trim() || null;
  } catch (error) {
    console.warn('[POST /api/webhooks/pebble] Audio transcription failed', error);
    return null;
  }
}

async function completeServerTranscription(input: {
  rowId: string;
  audio: Blob;
  attachment: Attachment;
  externalPayload: string;
}): Promise<void> {
  const transcript = await tryServerTranscription(input.audio);
  if (!transcript) {
    logPebble('background transcription left pending', { itemId: input.rowId });
    return;
  }

  const rawText = `${transcript}\n\n${attachmentReference(input.attachment)}`;
  const audit = JSON.parse(input.externalPayload) as Record<string, unknown>;
  audit.transcriptionSource = 'flow';

  try {
    const row = updateStream(input.rowId, {
      rawText,
      externalPayload: JSON.stringify(audit),
    });
    const triageQueued = row?.status === 'pending';
    if (triageQueued && row) onStreamCaptured(row.id);
    logPebble('background transcription completed', {
      itemId: input.rowId,
      transcriptCharacters: transcript.length,
      triageQueued,
    });
  } catch (error) {
    // A manual retry may have filled the same placeholder first. The original
    // capture remains durable, so a background race is diagnostic only.
    console.warn(
      '[POST /api/webhooks/pebble] Background transcription could not be applied',
      input.rowId,
      error,
    );
  }
}

async function removeUncommittedAttachment(attachment: Attachment | null): Promise<void> {
  if (!attachment) return;
  try {
    await unlink(attachmentPath(attachment.fileName));
  } catch (error) {
    console.warn(
      '[POST /api/webhooks/pebble] Could not clean up uncommitted audio',
      attachment.fileName,
      error,
    );
  }
}

async function ingestRecording(input: PebbleRecording): Promise<Response> {
  const {
    recordedAt,
    client,
    trigger,
    pebbleTranscription,
    audio,
  } = input;
  const externalId = String(recordedAt);
  const existing = findStreamByExternalId(EXTERNAL_SOURCE, externalId);
  if (existing) {
    logPebble('delivery deduplicated', {
      recordedAt,
      itemId: existing.id,
      point: 'initial lookup',
    });
    return Response.json({ ok: true, deduped: true, item_id: existing.id });
  }

  let attachment: Attachment | null = null;
  const transcription = pebbleTranscription;
  const transcriptionSource: TranscriptionSource = transcription ? 'pebble' : null;
  let row: StreamRecord;
  let externalPayload: string;

  try {
    if (audio) {
      const originalName = safeAudioName(audio, recordedAt);
      attachment = await saveAttachment({
        data: audio,
        originalName,
        mimeType: 'audio/mp4',
      });
    }

    const audioLink = attachment ? attachmentReference(attachment) : null;
    const rawText = transcription
      ? [transcription, audioLink].filter(Boolean).join('\n\n')
      : `[Voice memo, pending transcription]\n\n${audioLink}`;

    externalPayload = JSON.stringify({
      recordedAt,
      client,
      trigger,
      transcription: pebbleTranscription,
      transcriptionSource,
      audio: attachment
        ? {
            originalName: attachment.originalName,
            mimeType: attachment.mimeType,
            size: attachment.size,
          }
        : null,
    });

    const inserted = createExternalStream({
      rawText,
      source: 'webhook',
      media: 'voice',
      origin: 'webhook',
      externalSource: EXTERNAL_SOURCE,
      externalId,
      externalPayload,
      status: 'pending',
      attachments: attachment ? [attachment] : [],
      createdAt: new Date(recordedAt).toISOString(),
    });
    if (!inserted.created) {
      await removeUncommittedAttachment(attachment);
      logPebble('delivery deduplicated', {
        recordedAt,
        itemId: inserted.row.id,
        point: 'database conflict',
      });
      return Response.json({
        ok: true,
        deduped: true,
        item_id: inserted.row.id,
      });
    }
    row = inserted.row;
  } catch (error) {
    await removeUncommittedAttachment(attachment);
    throw error;
  }

  const serverTranscriptionQueued = !transcription && audio !== null && attachment !== null;
  if (transcription) {
    onStreamCaptured(row.id);
  } else if (audio && attachment) {
    after(() => completeServerTranscription({
      rowId: row.id,
      audio,
      attachment,
      externalPayload,
    }));
  }

  logPebble('capture created', {
    recordedAt,
    itemId: row.id,
    audioSaved: attachment !== null,
    transcriptionSource,
    triageQueued: transcription !== null,
    serverTranscriptionQueued,
  });

  return Response.json(
    {
      ok: true,
      item_id: row.id,
      audio_saved: attachment !== null,
      transcription_source: transcriptionSource,
      triage_queued: transcription !== null,
      server_transcription_queued: serverTranscriptionQueued,
    },
    { status: 201 },
  );
}

export async function POST(request: NextRequest) {
  const summary = requestSummary(request);
  const expectedSecret = process.env.PEBBLE_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error('[POST /api/webhooks/pebble] PEBBLE_WEBHOOK_SECRET not configured');
    return jsonError('webhook not configured', 503);
  }

  if (!secretsMatch(providedSecret(request), expectedSecret)) {
    return rejectPebble('unauthorized', 401, summary);
  }

  logPebble('request received', summary);

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return rejectPebble('Content-Type must be multipart/form-data', 415);
  }

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return rejectPebble(`request exceeds ${MAX_REQUEST_BYTES} bytes`, 413);
  }

  let body: ArrayBuffer;
  try {
    body = await readLimitedRequestBody(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return rejectPebble(`request exceeds ${MAX_REQUEST_BYTES} bytes`, 413);
    }
    return rejectPebble('failed to read request body', 400);
  }

  let formData: FormData;
  try {
    const parseRequest = new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
    formData = await parseRequest.formData();
  } catch {
    return rejectPebble('invalid multipart body', 400);
  }

  const fields = formFieldNames(formData);
  const recordedAt = parseRecordedAt(formString(formData, 'recordedAt'));
  if (recordedAt === null) {
    return rejectPebble(
      'recordedAt must be a positive Unix timestamp in milliseconds',
      400,
      { fields },
    );
  }

  const client = formString(formData, 'client');
  if (client !== 'ring') {
    return rejectPebble('client must be ring', 400, { fields });
  }

  const trigger = request.headers.get('x-index-trigger')?.trim() ?? '';
  if (!ALLOWED_TRIGGERS.has(trigger)) {
    return rejectPebble('invalid or missing X-Index-Trigger', 400, { fields });
  }

  const isTest = formString(formData, 'test') === 'true' ||
    request.headers.get('x-index-test')?.toLowerCase() === 'true' ||
    trigger === 'test-event';
  if (isTest) {
    logPebble('test event acknowledged', {
      recordedAt,
      capturedAt: new Date(recordedAt).toISOString(),
      client,
      trigger,
      fields,
      requestBytes: body.byteLength,
    });
    return Response.json({ ok: true, test: true });
  }

  const transcriptionField = formString(formData, 'transcription');
  const pebbleTranscription = transcriptionField?.trim() || null;
  if (pebbleTranscription && pebbleTranscription.length > MAX_TRANSCRIPTION_CHARS) {
    return rejectPebble(
      `transcription exceeds ${MAX_TRANSCRIPTION_CHARS} characters`,
      413,
      { fields },
    );
  }

  const audioField = formData.get('audio');
  const audio = audioField instanceof Blob && audioField.size > 0 ? audioField : null;
  if (!pebbleTranscription && !audio) {
    return rejectPebble('payload must include transcription or audio', 400, { fields });
  }

  if (audio && audio.size > MAX_AUDIO_BYTES) {
    return rejectPebble(`audio exceeds ${MAX_AUDIO_BYTES} bytes`, 413, { fields });
  }

  if (audio) {
    const audioName = safeAudioName(audio, recordedAt);
    const audioMime = resolveMime(audio.type, audioName);
    if (audioMime !== 'audio/mp4') {
      return rejectPebble(
        'audio must be an M4A file with Content-Type audio/mp4',
        415,
        { fields, audioName, audioContentType: audio.type || null, audioBytes: audio.size },
      );
    }

    const advertisedSize = request.headers.get('x-audio-size');
    if (advertisedSize !== null &&
      (!/^\d+$/.test(advertisedSize) || Number(advertisedSize) !== audio.size)) {
      return rejectPebble('X-Audio-Size does not match the audio part', 400, {
        fields,
        advertisedAudioBytes: advertisedSize,
        audioBytes: audio.size,
      });
    }
  }

  logPebble('payload validated', {
    recordedAt,
    capturedAt: new Date(recordedAt).toISOString(),
    client,
    trigger,
    fields,
    requestBytes: body.byteLength,
    transcriptionPresent: pebbleTranscription !== null,
    transcriptionCharacters: pebbleTranscription?.length ?? 0,
    audio: audio
      ? {
          name: safeAudioName(audio, recordedAt),
          contentType: audio.type || null,
          bytes: audio.size,
          advertisedBytes: request.headers.get('x-audio-size'),
        }
      : null,
  });

  const externalId = String(recordedAt);
  const active = inFlightRecordings.get(externalId);
  if (active) {
    try {
      await active;
    } catch {
      // The first attempt failed. This request gets its own durable attempt.
    }
    const existing = findStreamByExternalId(EXTERNAL_SOURCE, externalId);
    if (existing) {
      logPebble('delivery deduplicated', {
        recordedAt,
        itemId: existing.id,
        point: 'in-process wait',
      });
      return Response.json({ ok: true, deduped: true, item_id: existing.id });
    }
  }

  const operation = ingestRecording({
    recordedAt,
    client: 'ring',
    trigger,
    pebbleTranscription,
    audio,
  });
  inFlightRecordings.set(externalId, operation);

  try {
    return await operation;
  } catch (error) {
    console.error('[POST /api/webhooks/pebble] Ingestion failed', error);
    return jsonError('failed to ingest webhook', 500);
  } finally {
    if (inFlightRecordings.get(externalId) === operation) {
      inFlightRecordings.delete(externalId);
    }
  }
}
