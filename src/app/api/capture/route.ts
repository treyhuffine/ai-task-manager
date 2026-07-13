/**
 * POST /api/capture
 *
 * Unified quick-capture endpoint for automations (iOS Shortcuts, webhooks,
 * CLI scripts, etc.). Accepts either:
 *
 *   1. Audio file (multipart/form-data with `file` field)
 *      → transcribes server-side using the user's saved voice model,
 *        creates a stream item with media='voice'
 *      → if no STT provider is available, saves the audio file to the
 *        attachments dir and creates a stream item noting the pending
 *        transcription. The rawText embeds `/api/attachments/<fileName>`
 *        so the saved audio shows up in the stream's attachments manifest.
 *
 *   2. Image file (multipart/form-data with `file` field, image/* MIME)
 *      → saves the image as an attachment (always), then calls GPT vision
 *        with an optional user-provided `text` field. The model decides
 *        whether the user text is additional content to append or an
 *        instruction on how to interpret the image, based on context.
 *      → creates a stream item with media='image'
 *
 *   3. Text (JSON `{ text: "..." }` or form field `text`)
 *      → creates a stream item with media='text'
 *
 * Returns the created stream item.
 *
 * Auth: Bearer token from `flow pair`.
 */

import { NextRequest } from 'next/server';
import { createStream, getUserState } from '@/lib/db/queries';
import { saveAttachment } from '@/lib/attachments/save';
import { transcribe, pickProvider } from '@/lib/stt/transcribe';
import { extractImageContent } from '@/lib/capture/extract-image';
import { onStreamCaptured } from '@/lib/stream-triage/triggers';
import type { Attachment } from '@/db/types';

/** Save an audio blob through the attachments system and build an inline
 *  reference that the stream's `rawText` can carry. */
async function saveVoiceAttachment(file: Blob): Promise<Attachment> {
  const mime = file.type || 'audio/webm';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = mime.split('/')[1]?.split(';')[0] ?? 'webm';
  return saveAttachment({
    data: file,
    originalName: `voice-memo-${stamp}.${ext}`,
    mimeType: mime,
  });
}

async function saveImageAttachment(file: Blob): Promise<Attachment> {
  const mime = file.type || 'image/jpeg';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = mime.split('/')[1]?.split(';')[0] ?? 'jpg';
  const name = (file as unknown as { name?: string }).name;
  return saveAttachment({
    data: file,
    originalName: name && name.trim() ? name : `photo-${stamp}.${ext}`,
    mimeType: mime,
  });
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') ?? '';

    let rawText: string;
    let source: 'capture' | 'chat' = 'capture';
    let media: 'text' | 'voice' | 'image' = 'text';
    let attachment: Attachment | undefined;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const files = formData.getAll('file').filter(f => f instanceof Blob && f.size > 0) as Blob[];
      const text = formData.get('text') as string | null;

      if (files.length > 0) {
        const isImageBatch = files[0].type.startsWith('image/');
        
        // ── Image path ──
        if (isImageBatch) {
          media = 'image';
          
          const imageAttachments = await Promise.all(files.map(saveImageAttachment));
          const imageRefs = imageAttachments.map(a => `![${a.originalName}](/api/attachments/${a.fileName})`).join('\n\n');
          const userText = (formData.get('text') as string | null) ?? null;

          let extracted: string | null = null;
          try {
            const imageItems = await Promise.all(
              files.map(async (file, idx) => ({
                bytes: new Uint8Array(await file.arrayBuffer()),
                mime: imageAttachments[idx].mimeType,
              }))
            );
            extracted = await extractImageContent(imageItems, userText);
          } catch (err) {
            console.warn('[POST /api/capture] Image extraction failed, images saved.', err);
          }

          const body = extracted
            ? `${extracted}\n\n${imageRefs}`
            : `[Images, extraction pending]${userText?.trim() ? `\n\n${userText.trim()}` : ''}\n\n${imageRefs}`;

          const row = createStream({
            rawText: body,
            source,
            media,
            status: 'pending',
            attachments: imageAttachments,
          });
          if (extracted) onStreamCaptured(row.id);

          return Response.json(
            {
              item: row,
              extracted: extracted ?? undefined,
              imagesSaved: true,
            },
            { status: 201 },
          );
        }

        // ── Audio path ──
        // (Assuming audio is still sent one at a time via Quick Capture)
        const file = files[0];
        media = 'voice';

        // Voice model priority: explicit param → user preference → auto-pick
        const explicitModel = formData.get('voiceModel') as string | null;
        let voiceModel: string | null = explicitModel || getUserState()?.voiceModel || null;

        if (!voiceModel) {
          try {
            voiceModel = await pickProvider();
          } catch {
            // No provider available — fall through to save-only path
          }
        }

        if (voiceModel) {
          try {
            rawText = await transcribe(file, voiceModel);
          } catch (err) {
            // Transcription failed — save audio so it's not lost
            attachment = await saveVoiceAttachment(file);
            rawText = `[Voice memo, transcription failed]\n\n[${attachment.originalName}](/api/attachments/${attachment.fileName})`;
            console.warn('[POST /api/capture] Transcription failed, audio saved:', attachment.fileName, err);
          }
        } else {
          // No STT provider at all — save audio for later
          attachment = await saveVoiceAttachment(file);
          rawText = `[Voice memo, pending transcription]\n\n[${attachment.originalName}](/api/attachments/${attachment.fileName})`;
        }

        const row = createStream({
          rawText: rawText,
          source,
          media,
          status: 'pending',
          attachments: attachment ? [attachment] : [],
        });
        // Placeholder rows (failed/pending transcription) wait for the retry
        // path to become readable before triage sees them.
        if (!attachment) onStreamCaptured(row.id);

        return Response.json(
          {
            item: row,
            transcript: !attachment ? rawText : undefined,
            audioSaved: !!attachment,
          },
          { status: 201 },
        );
      } else if (text?.trim()) {
        rawText = text.trim();
      } else {
        return Response.json(
          { error: 'Provide a `file` (audio) or `text` field' },
          { status: 400 },
        );
      }
    } else {
      // ── JSON text path ──
      const body = await request.json();
      if (!body.text?.trim()) {
        return Response.json({ error: '`text` is required' }, { status: 400 });
      }
      rawText = body.text.trim();
      source = body.source ?? 'capture';
    }

    const row = createStream({
      rawText: rawText,
      source,
      media,
      status: 'pending',
    });
    onStreamCaptured(row.id);

    return Response.json({ item: row }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/capture]', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
