/**
 * POST /api/capture
 *
 * Unified quick-capture endpoint for automations (iOS Shortcuts, webhooks,
 * CLI scripts, etc.). Accepts either:
 *
 *   1. Audio file (multipart/form-data with `file` field)
 *      → transcribes server-side using the user's saved voice model,
 *        creates a stream item with source='voice'
 *      → if no STT provider is available, saves the audio file to the
 *        attachments dir and creates a stream item noting the pending
 *        transcription. The raw_text embeds `/api/attachments/<file_name>`
 *        so the saved audio shows up in the stream's attachments manifest.
 *
 *   2. Text (JSON `{ text: "..." }` or form field `text`)
 *      → creates a stream item with source='capture'
 *
 * Returns the created stream item + transcript (if audio).
 *
 * Auth: Bearer token from `flow pair`.
 */

import { NextRequest } from 'next/server';
import { createStream, getUserState } from '@/lib/db/queries';
import { saveAttachment } from '@/lib/attachments/save';
import { transcribe, pickProvider } from '@/lib/stt/transcribe';
import type { Attachment } from '@/db/types';

/** Save an audio blob through the attachments system and build an inline
 *  reference that the stream's `raw_text` can carry. */
async function saveVoiceAttachment(file: Blob): Promise<Attachment> {
  const mime = file.type || 'audio/webm';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = mime.split('/')[1]?.split(';')[0] ?? 'webm';
  return saveAttachment({
    data: file,
    original_name: `voice-memo-${stamp}.${ext}`,
    mime_type: mime,
  });
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') ?? '';

    let rawText: string;
    let source: 'capture' | 'chat' = 'capture';
    let media: 'text' | 'voice' = 'text';
    let attachment: Attachment | undefined;

    if (contentType.includes('multipart/form-data')) {
      // ── Audio path ──
      const formData = await request.formData();
      const file = formData.get('file') as Blob | null;
      const text = formData.get('text') as string | null;

      if (file && file.size > 0) {
        media = 'voice';

        // Voice model priority: explicit param → user preference → auto-pick
        const explicitModel = formData.get('voice_model') as string | null;
        let voiceModel: string | null = explicitModel || getUserState()?.voice_model || null;

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
            rawText = `[Voice memo — transcription failed]\n\n[${attachment.original_name}](/api/attachments/${attachment.file_name})`;
            console.warn('[POST /api/capture] Transcription failed, audio saved:', attachment.file_name, err);
          }
        } else {
          // No STT provider at all — save audio for later
          attachment = await saveVoiceAttachment(file);
          rawText = `[Voice memo — pending transcription]\n\n[${attachment.original_name}](/api/attachments/${attachment.file_name})`;
        }

        const row = createStream({
          raw_text: rawText,
          source,
          media,
          status: 'pending',
          attachments: attachment ? [attachment] : [],
        });

        return Response.json(
          {
            item: row,
            transcript: !attachment ? rawText : undefined,
            audio_saved: !!attachment,
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
      raw_text: rawText,
      source,
      media,
      status: 'pending',
    });

    return Response.json({ item: row }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/capture]', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
