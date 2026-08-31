import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createExternalStream: vi.fn(),
  findStreamByExternalId: vi.fn(),
  getUserState: vi.fn(),
  updateStream: vi.fn(),
  saveAttachment: vi.fn(),
  attachmentPath: vi.fn(),
  pickProvider: vi.fn(),
  transcribe: vi.fn(),
  onStreamCaptured: vi.fn(),
  unlink: vi.fn(),
  after: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}));

vi.mock('@/lib/db/queries', () => ({
  createExternalStream: mocks.createExternalStream,
  findStreamByExternalId: mocks.findStreamByExternalId,
  getUserState: mocks.getUserState,
  updateStream: mocks.updateStream,
}));

vi.mock('@/lib/attachments/save', () => ({
  saveAttachment: mocks.saveAttachment,
  attachmentPath: mocks.attachmentPath,
}));

vi.mock('@/lib/stt/transcribe', () => ({
  pickProvider: mocks.pickProvider,
  transcribe: mocks.transcribe,
}));

vi.mock('@/lib/stream-triage/triggers', () => ({
  onStreamCaptured: mocks.onStreamCaptured,
}));

vi.mock('node:fs/promises', () => ({
  unlink: mocks.unlink,
}));

import { POST } from './route';

const SECRET = 'pebble-test-secret-with-enough-entropy';
const PREVIOUS_SECRET = process.env.PEBBLE_WEBHOOK_SECRET;
const RECORDED_AT = '1788112345678';
const STORED_ATTACHMENT = {
  fileName: '01991234-aaaa-7bbb-8ccc-0123456789ab.m4a',
  originalName: 'recording-123.m4a',
  mimeType: 'audio/mp4',
  size: 4,
  uploadedAt: '2026-08-30T12:00:00.000Z',
};

interface RequestOptions {
  transcription?: string;
  audio?: Blob;
  audioName?: string;
  recordedAt?: string;
  client?: string;
  trigger?: string;
  secret?: string | null;
  authorization?: boolean;
  test?: boolean;
  headers?: Record<string, string>;
}

function multipartRequest(options: RequestOptions = {}): NextRequest {
  const formData = new FormData();
  formData.set('recordedAt', options.recordedAt ?? RECORDED_AT);
  formData.set('client', options.client ?? 'ring');
  if (options.transcription !== undefined) {
    formData.set('transcription', options.transcription);
  }
  if (options.audio) {
    formData.set('audio', options.audio, options.audioName ?? 'recording-123.m4a');
  }
  if (options.test) formData.set('test', 'true');

  const headers = new Headers(options.headers);
  const secret = options.secret === undefined ? SECRET : options.secret;
  if (secret !== null) {
    if (options.authorization) {
      headers.set('authorization', `Bearer ${secret}`);
    } else {
      headers.set('x-pebble-webhook-secret', secret);
    }
  }
  headers.set('x-index-trigger', options.trigger ?? 'single-click-hold');

  return new NextRequest('http://localhost/api/webhooks/pebble', {
    method: 'POST',
    headers,
    body: formData,
  });
}

function audio(type = 'audio/mp4'): Blob {
  return new Blob([new Uint8Array([1, 2, 3, 4])], { type });
}

function oversizedStreamingRequest(contentLength?: string): NextRequest {
  const oneMiB = new Uint8Array(1024 * 1024);
  let chunksSent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(oneMiB);
      chunksSent += 1;
      if (chunksSent === 52) controller.close();
    },
  });
  const headers = new Headers({
    authorization: `Bearer ${SECRET}`,
    'content-type': 'multipart/form-data; boundary=unused',
    'x-index-trigger': 'single-click-hold',
  });
  if (contentLength !== undefined) headers.set('content-length', contentLength);

  const init = {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  };
  return new NextRequest(
    'http://localhost/api/webhooks/pebble',
    init as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PEBBLE_WEBHOOK_SECRET = SECRET;
  mocks.findStreamByExternalId.mockReturnValue(undefined);
  mocks.createExternalStream.mockReturnValue({
    row: { id: 'stream-1' },
    created: true,
  });
  mocks.getUserState.mockReturnValue({ voiceModel: 'local/parakeet-tdt-0.6b-v3' });
  mocks.updateStream.mockReturnValue({ id: 'stream-1', status: 'pending' });
  mocks.pickProvider.mockResolvedValue('local/parakeet-tdt-0.6b-v3');
  mocks.transcribe.mockResolvedValue('Server transcript');
  mocks.saveAttachment.mockResolvedValue(STORED_ATTACHMENT);
  mocks.attachmentPath.mockReturnValue('/tmp/attachment.m4a');
  mocks.unlink.mockResolvedValue(undefined);
  mocks.after.mockImplementation((task: () => unknown) => {
    void task();
  });
});

afterAll(() => {
  if (PREVIOUS_SECRET === undefined) {
    delete process.env.PEBBLE_WEBHOOK_SECRET;
  } else {
    process.env.PEBBLE_WEBHOOK_SECRET = PREVIOUS_SECRET;
  }
});

describe('POST /api/webhooks/pebble', () => {
  it('fails closed when the receiver secret is not configured', async () => {
    delete process.env.PEBBLE_WEBHOOK_SECRET;

    const response = await POST(multipartRequest({ transcription: 'hello' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'webhook not configured' });
    expect(mocks.findStreamByExternalId).not.toHaveBeenCalled();
  });

  it('rejects a bad secret before parsing the multipart body', async () => {
    const request = multipartRequest({ transcription: 'hello', secret: 'wrong' });
    const formDataSpy = vi.spyOn(request, 'formData');
    const bodyReaderSpy = vi.spyOn(request.body!, 'getReader');

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(bodyReaderSpy).not.toHaveBeenCalled();
  });

  it('accepts a conventional Authorization Bearer header', async () => {
    const response = await POST(multipartRequest({
      transcription: 'Remember the milk',
      authorization: true,
    }));

    expect(response.status).toBe(201);
    expect(mocks.createExternalStream).toHaveBeenCalledOnce();
  });

  it('requires multipart/form-data', async () => {
    const request = new NextRequest('http://localhost/api/webhooks/pebble', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${SECRET}`,
        'content-type': 'application/json',
        'x-index-trigger': 'single-click-hold',
      },
      body: JSON.stringify({ transcription: 'hello' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(415);
    expect(mocks.createExternalStream).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared request before parsing it', async () => {
    const request = multipartRequest({
      transcription: 'hello',
      headers: { 'content-length': String(52 * 1024 * 1024) },
    });
    const formDataSpy = vi.spyOn(request, 'formData');
    const bodyReaderSpy = vi.spyOn(request.body!, 'getReader');

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(bodyReaderSpy).not.toHaveBeenCalled();
  });

  it.each([undefined, '1'])(
    'enforces the actual body limit with Content-Length %s',
    async (contentLength) => {
      const response = await POST(oversizedStreamingRequest(contentLength));

      expect(response.status).toBe(413);
      expect(mocks.createExternalStream).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed multipart bytes', async () => {
    const request = new NextRequest('http://localhost/api/webhooks/pebble', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${SECRET}`,
        'content-type': 'multipart/form-data; boundary=missing',
        'x-index-trigger': 'single-click-hold',
      },
      body: 'not a multipart body',
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid multipart body' });
    expect(mocks.createExternalStream).not.toHaveBeenCalled();
  });

  it('acknowledges Pebble test events without creating a capture', async () => {
    const response = await POST(multipartRequest({
      transcription: 'Index webhook test event',
      trigger: 'test-event',
      test: true,
      headers: { 'x-index-test': 'true' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, test: true });
    expect(mocks.findStreamByExternalId).not.toHaveBeenCalled();
    expect(mocks.saveAttachment).not.toHaveBeenCalled();
    expect(mocks.createExternalStream).not.toHaveBeenCalled();
  });

  it('ingests a transcription-only delivery as a readable voice capture', async () => {
    const response = await POST(multipartRequest({
      transcription: '  Pick up milk on the way home.  ',
      trigger: 'double-click-hold',
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      item_id: 'stream-1',
      audio_saved: false,
      transcription_source: 'pebble',
      triage_queued: true,
      server_transcription_queued: false,
    });
    expect(mocks.findStreamByExternalId)
      .toHaveBeenCalledWith('pebble-index-01', RECORDED_AT);
    expect(mocks.createExternalStream).toHaveBeenCalledWith(expect.objectContaining({
      rawText: 'Pick up milk on the way home.',
      source: 'webhook',
      media: 'voice',
      origin: 'webhook',
      externalSource: 'pebble-index-01',
      externalId: RECORDED_AT,
      status: 'pending',
      attachments: [],
      createdAt: new Date(Number(RECORDED_AT)).toISOString(),
    }));
    const input = mocks.createExternalStream.mock.calls[0][0];
    expect(JSON.parse(input.externalPayload)).toEqual({
      recordedAt: Number(RECORDED_AT),
      client: 'ring',
      trigger: 'double-click-hold',
      transcription: 'Pick up milk on the way home.',
      transcriptionSource: 'pebble',
      audio: null,
    });
    expect(mocks.saveAttachment).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(mocks.onStreamCaptured).toHaveBeenCalledOnce();
    expect(mocks.onStreamCaptured).toHaveBeenCalledWith('stream-1');
  });

  it('deduplicates on recordedAt before saving an audio attachment', async () => {
    mocks.findStreamByExternalId.mockReturnValue({ id: 'stream-existing' });

    const response = await POST(multipartRequest({ audio: audio() }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      deduped: true,
      item_id: 'stream-existing',
    });
    expect(mocks.saveAttachment).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(mocks.createExternalStream).not.toHaveBeenCalled();
    expect(mocks.onStreamCaptured).not.toHaveBeenCalled();
  });

  it('serializes concurrent redeliveries so audio and Stream are written once', async () => {
    let stored: { id: string } | undefined;
    let releaseSave: ((value: typeof STORED_ATTACHMENT) => void) | undefined;
    const pendingSave = new Promise<typeof STORED_ATTACHMENT>((resolve) => {
      releaseSave = resolve;
    });
    mocks.saveAttachment.mockReturnValue(pendingSave);
    mocks.findStreamByExternalId.mockImplementation(() => stored);
    mocks.createExternalStream.mockImplementation(() => {
      stored = { id: 'stream-1' };
      return { row: stored, created: true };
    });

    const first = POST(multipartRequest({
      transcription: 'One recording',
      audio: audio(),
    }));
    await vi.waitFor(() => expect(mocks.saveAttachment).toHaveBeenCalledOnce());
    const second = POST(multipartRequest({
      transcription: 'One recording',
      audio: audio(),
    }));

    releaseSave?.(STORED_ATTACHMENT);
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toMatchObject({ deduped: true, item_id: 'stream-1' });
    expect(mocks.saveAttachment).toHaveBeenCalledOnce();
    expect(mocks.createExternalStream).toHaveBeenCalledOnce();
    expect(mocks.onStreamCaptured).toHaveBeenCalledOnce();
  });

  it('cleans up its audio when another process wins the database insert', async () => {
    mocks.createExternalStream.mockReturnValue({
      row: { id: 'stream-existing' },
      created: false,
    });

    const response = await POST(multipartRequest({
      transcription: 'One recording',
      audio: audio(),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      deduped: true,
      item_id: 'stream-existing',
    });
    expect(mocks.unlink).toHaveBeenCalledWith('/tmp/attachment.m4a');
    expect(mocks.onStreamCaptured).not.toHaveBeenCalled();
  });

  it('preserves the M4A when Pebble sends recording and transcription', async () => {
    const recording = audio();
    const response = await POST(multipartRequest({
      transcription: 'Book the dentist appointment.',
      audio: recording,
      headers: { 'x-audio-size': String(recording.size) },
    }));

    expect(response.status).toBe(201);
    expect(mocks.saveAttachment).toHaveBeenCalledWith({
      data: expect.any(Blob),
      originalName: 'recording-123.m4a',
      mimeType: 'audio/mp4',
    });
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(mocks.createExternalStream).toHaveBeenCalledWith(expect.objectContaining({
      rawText:
        'Book the dentist appointment.\n\n' +
        `[${STORED_ATTACHMENT.originalName}](/api/attachments/${STORED_ATTACHMENT.fileName})`,
      attachments: [STORED_ATTACHMENT],
    }));
    const payload = JSON.parse(mocks.createExternalStream.mock.calls[0][0].externalPayload);
    expect(payload.audio).toEqual({
      originalName: STORED_ATTACHMENT.originalName,
      mimeType: 'audio/mp4',
      size: 4,
    });
  });

  it('logs payload metadata without logging secrets or transcript text', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const transcript = 'PRIVATE_TRANSCRIPT_MARKER';
    const recording = audio();

    try {
      const response = await POST(multipartRequest({
        transcription: transcript,
        audio: recording,
        authorization: true,
        headers: { 'x-audio-size': String(recording.size) },
      }));

      expect(response.status).toBe(201);
      const validatedCall = info.mock.calls.find(
        ([message]) => message === '[POST /api/webhooks/pebble] payload validated',
      );
      expect(validatedCall).toBeDefined();
      expect(JSON.parse(validatedCall?.[1] as string)).toMatchObject({
        recordedAt: Number(RECORDED_AT),
        client: 'ring',
        trigger: 'single-click-hold',
        fields: ['audio', 'client', 'recordedAt', 'transcription'],
        transcriptionPresent: true,
        transcriptionCharacters: transcript.length,
        audio: {
          name: 'recording-123.m4a',
          contentType: 'audio/mp4',
          bytes: recording.size,
          advertisedBytes: String(recording.size),
        },
      });
      expect(info.mock.calls.some(
        ([message]) => message === '[POST /api/webhooks/pebble] capture created',
      )).toBe(true);

      const output = info.mock.calls.flat().map(String).join('\n');
      expect(output).not.toContain(transcript);
      expect(output).not.toContain(SECRET);
      expect(output.toLowerCase()).not.toContain('authorization');
      expect(output.toLowerCase()).not.toContain('boundary=');
    } finally {
      info.mockRestore();
    }
  });

  it('persists recording-only delivery before transcribing it in the background', async () => {
    let releaseTranscription: ((value: string) => void) | undefined;
    mocks.transcribe.mockReturnValue(new Promise<string>((resolve) => {
      releaseTranscription = resolve;
    }));

    const response = await POST(multipartRequest({ audio: audio() }));

    expect(response.status).toBe(201);
    expect(mocks.createExternalStream).toHaveBeenCalledWith(expect.objectContaining({
      rawText:
        '[Voice memo, pending transcription]\n\n' +
        `[${STORED_ATTACHMENT.originalName}](/api/attachments/${STORED_ATTACHMENT.fileName})`,
    }));
    expect(await response.json()).toMatchObject({
      transcription_source: null,
      triage_queued: false,
      server_transcription_queued: true,
    });
    expect(mocks.updateStream).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledWith(
      expect.any(Blob),
      'local/parakeet-tdt-0.6b-v3',
      expect.any(AbortSignal),
    ));
    expect(mocks.after).toHaveBeenCalledOnce();
    releaseTranscription?.('Server transcript');
    await vi.waitFor(() => expect(mocks.updateStream).toHaveBeenCalledWith(
      'stream-1',
      expect.objectContaining({
        rawText:
          'Server transcript\n\n' +
          `[${STORED_ATTACHMENT.originalName}](/api/attachments/${STORED_ATTACHMENT.fileName})`,
      }),
    ));
    const update = mocks.updateStream.mock.calls[0][1];
    expect(JSON.parse(update.externalPayload)).toMatchObject({
      transcription: null,
      transcriptionSource: 'flow',
    });
    expect(mocks.onStreamCaptured).toHaveBeenCalledWith('stream-1');
  });

  it('keeps audio-only captures retryable when no STT provider is available', async () => {
    mocks.getUserState.mockReturnValue(null);
    mocks.pickProvider.mockRejectedValue(new Error('not configured'));

    const response = await POST(multipartRequest({ audio: audio() }));

    expect(response.status).toBe(201);
    expect(mocks.createExternalStream).toHaveBeenCalledWith(expect.objectContaining({
      rawText:
        '[Voice memo, pending transcription]\n\n' +
        `[${STORED_ATTACHMENT.originalName}](/api/attachments/${STORED_ATTACHMENT.fileName})`,
    }));
    expect(await response.json()).toMatchObject({
      transcription_source: null,
      triage_queued: false,
      server_transcription_queued: true,
    });
    await vi.waitFor(() => expect(mocks.pickProvider).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(mocks.updateStream).not.toHaveBeenCalled();
    expect(mocks.onStreamCaptured).not.toHaveBeenCalled();
  });

  it.each([
    ['missing timestamp', { recordedAt: '', transcription: 'hello' }, 400],
    ['wrong client', { client: 'watch', transcription: 'hello' }, 400],
    ['missing trigger', { trigger: '', transcription: 'hello' }, 400],
    ['missing content', {}, 400],
  ])('rejects %s', async (_label, overrides, expectedStatus) => {
    const response = await POST(multipartRequest(overrides as RequestOptions));

    expect(response.status).toBe(expectedStatus);
    expect(mocks.createExternalStream).not.toHaveBeenCalled();
  });

  it('caps transcription text before creating a capture', async () => {
    const response = await POST(multipartRequest({
      transcription: 'x'.repeat(200_001),
    }));

    expect(response.status).toBe(413);
    expect(mocks.createExternalStream).not.toHaveBeenCalled();
  });

  it('rejects an unexpected audio type and a mismatched X-Audio-Size', async () => {
    const badMime = await POST(multipartRequest({
      audio: audio('audio/mpeg'),
      audioName: 'recording.mp3',
    }));
    expect(badMime.status).toBe(415);

    const badSize = await POST(multipartRequest({
      audio: audio(),
      headers: { 'x-audio-size': '999' },
    }));
    expect(badSize.status).toBe(400);
    expect(mocks.createExternalStream).not.toHaveBeenCalled();
  });

  it('removes a newly saved file when the database insert fails', async () => {
    mocks.createExternalStream.mockImplementation(() => {
      throw new Error('database unavailable');
    });

    const response = await POST(multipartRequest({
      transcription: 'Keep this',
      audio: audio(),
    }));

    expect(response.status).toBe(500);
    expect(mocks.attachmentPath).toHaveBeenCalledWith(STORED_ATTACHMENT.fileName);
    expect(mocks.unlink).toHaveBeenCalledWith('/tmp/attachment.m4a');
    expect(mocks.onStreamCaptured).not.toHaveBeenCalled();
  });
});
