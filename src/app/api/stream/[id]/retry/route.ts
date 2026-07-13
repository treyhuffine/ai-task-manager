/**
 * POST /api/stream/:id/retry — re-run failed voice transcription or image
 * extraction for a capture whose raw text is still a preprocessing
 * placeholder. The one sanctioned raw_text rewrite (placeholder → first
 * real content). On success the capture flows through the normal
 * post-capture hooks (debounce bump + urgency lane).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getStream,
  updateStream,
  getUserState,
  streamRawTextIsPlaceholder,
} from '@/lib/db/queries';
import { getAttachmentsDir } from '@/lib/config/paths';
import { transcribe, pickProvider } from '@/lib/stt/transcribe';
import { extractImageContent } from '@/lib/capture/extract-image';
import { onStreamCaptured } from '@/lib/stream-triage/triggers';
import { triageErrorResponse } from '@/lib/stream-triage/http';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const item = getStream(id);
    if (!item) return Response.json({ error: 'Stream item not found' }, { status: 404 });
    if (!streamRawTextIsPlaceholder(item.rawText)) {
      return Response.json(
        { error: 'This capture already has its content. Nothing to retry.', code: 'conflict' },
        { status: 409 },
      );
    }

    const attachments = item.attachments ?? [];

    if (item.media === 'voice') {
      const audio = attachments.find((a) => a.mimeType.startsWith('audio/'));
      if (!audio) {
        return Response.json({ error: 'No saved audio to transcribe.', code: 'conflict' }, { status: 409 });
      }
      const bytes = await fs.readFile(path.join(getAttachmentsDir(), audio.fileName));
      const voiceModel = getUserState()?.voiceModel || (await pickProvider());
      const transcript = await transcribe(
        new Blob([new Uint8Array(bytes)], { type: audio.mimeType }),
        voiceModel,
      );
      const rawText = `${transcript.trim()}\n\n[${audio.originalName}](/api/attachments/${audio.fileName})`;
      const row = updateStream(id, { rawText });
      onStreamCaptured(id);
      return Response.json({ item: row, transcript: transcript.trim() });
    }

    if (item.media === 'image') {
      const images = attachments.filter((a) => a.mimeType.startsWith('image/'));
      if (images.length === 0) {
        return Response.json({ error: 'No saved images to read.', code: 'conflict' }, { status: 409 });
      }
      const imageItems = await Promise.all(
        images.map(async (a) => ({
          bytes: new Uint8Array(await fs.readFile(path.join(getAttachmentsDir(), a.fileName))),
          mime: a.mimeType,
        })),
      );
      const extracted = await extractImageContent(imageItems, null);
      const imageRefs = images
        .map((a) => `![${a.originalName}](/api/attachments/${a.fileName})`)
        .join('\n\n');
      const row = updateStream(id, { rawText: `${extracted}\n\n${imageRefs}` });
      onStreamCaptured(id);
      return Response.json({ item: row, extracted });
    }

    return Response.json({ error: 'Only voice and image captures have preprocessing to retry.', code: 'invalid_params' }, { status: 400 });
  } catch (err) {
    return triageErrorResponse('POST /api/stream/:id/retry', err);
  }
}
