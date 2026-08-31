import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createExternalStream: vi.fn(),
  findStreamByExternalId: vi.fn(),
  onStreamCaptured: vi.fn(),
}));

vi.mock('@/lib/db/queries', () => ({
  createExternalStream: mocks.createExternalStream,
  findStreamByExternalId: mocks.findStreamByExternalId,
}));

vi.mock('@/lib/stream-triage/triggers', () => ({
  onStreamCaptured: mocks.onStreamCaptured,
}));

import { POST } from './route';

const SECRET = 'pocket-test-secret';
const PREVIOUS_SECRET = process.env.POCKET_WEBHOOK_SECRET;

function pocketRequest(
  payload: unknown,
  options: { secret?: string; userAgent?: string } = {},
): NextRequest {
  return new NextRequest(
    `http://localhost/api/webhooks/pocket?secret=${encodeURIComponent(options.secret ?? SECRET)}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': options.userAgent ?? 'HeyPocket-Webhook/1.0',
      },
      body: JSON.stringify(payload),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.POCKET_WEBHOOK_SECRET = SECRET;
  mocks.findStreamByExternalId.mockReturnValue(undefined);
  mocks.createExternalStream.mockReturnValue({
    row: { id: 'stream-new' },
    created: true,
  });
});

afterAll(() => {
  if (PREVIOUS_SECRET === undefined) delete process.env.POCKET_WEBHOOK_SECRET;
  else process.env.POCKET_WEBHOOK_SECRET = PREVIOUS_SECRET;
});

describe('POST /api/webhooks/pocket', () => {
  it('fails closed when its secret is absent or incorrect', async () => {
    delete process.env.POCKET_WEBHOOK_SECRET;
    const unconfigured = await POST(pocketRequest({}));
    expect(unconfigured.status).toBe(503);

    process.env.POCKET_WEBHOOK_SECRET = SECRET;
    const unauthorized = await POST(pocketRequest({}, { secret: 'wrong' }));
    expect(unauthorized.status).toBe(401);
    expect(mocks.createExternalStream).not.toHaveBeenCalled();
  });

  it('acknowledges events that do not contain a completed transcript', async () => {
    const response = await POST(pocketRequest({ event: 'recording.created' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, skipped: 'recording.created' });
    expect(mocks.createExternalStream).not.toHaveBeenCalled();
  });

  it('formats and atomically creates a completed transcript', async () => {
    const payload = {
      event: 'transcription.completed',
      recording: { id: 'recording-1' },
      transcript: [
        { speaker: 'Alex', text: '  First thought. ' },
        { speaker: 'Alex', text: 'Second thought.' },
        { speaker: 'Sam', text: 'A reply.' },
      ],
    };

    const response = await POST(pocketRequest(payload));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, item_id: 'stream-new' });
    expect(mocks.createExternalStream).toHaveBeenCalledWith({
      rawText: '**Alex:** First thought. Second thought.\n\n**Sam:** A reply.',
      source: 'webhook',
      media: 'voice',
      origin: 'webhook',
      externalSource: 'pocket',
      externalId: 'recording-1',
      externalPayload: JSON.stringify(payload),
      status: 'pending',
    });
    expect(mocks.onStreamCaptured).toHaveBeenCalledWith('stream-new');
  });

  it('returns the canonical row when another process wins the insert', async () => {
    mocks.createExternalStream.mockReturnValue({
      row: { id: 'stream-existing' },
      created: false,
    });

    const response = await POST(pocketRequest({
      event: 'transcription.completed',
      recording: { id: 'recording-1' },
      transcript: [{ text: 'Same delivery' }],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      deduped: true,
      item_id: 'stream-existing',
    });
    expect(mocks.onStreamCaptured).not.toHaveBeenCalled();
  });

  it('deduplicates before formatting or creating', async () => {
    mocks.findStreamByExternalId.mockReturnValue({ id: 'stream-existing' });

    const response = await POST(pocketRequest({
      event: 'transcription.completed',
      recording: { id: 'recording-1' },
      transcript: [{ text: 'Same delivery' }],
    }));

    expect(response.status).toBe(200);
    expect(mocks.createExternalStream).not.toHaveBeenCalled();
    expect(mocks.onStreamCaptured).not.toHaveBeenCalled();
  });
});
