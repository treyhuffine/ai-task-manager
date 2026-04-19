/**
 * POST /api/capture
 *
 * Unified quick-capture endpoint for automations (iOS Shortcuts, webhooks,
 * CLI scripts, etc.). Accepts either:
 *
 *   1. Audio file (multipart/form-data with `file` field)
 *      → transcribes server-side using the user's saved voice model,
 *        creates stream item with source='voice'
 *      → if no STT provider is available, saves the audio file to disk
 *        and creates a stream item noting the pending transcription
 *
 *   2. Text (JSON `{ text: "..." }` or form field `text`)
 *      → creates stream item with source='capture'
 *
 * Returns the created stream item + transcript (if audio).
 *
 * Auth: Bearer token from `flow pair`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { stream } from '@/lib/db/schema';
import { uuidv7 } from 'uuidv7';
import { upsertEmbedding, buildEmbeddingText } from '@/lib/embeddings/embed';
import { syncEntity } from '@/lib/export/mirror';
import { transcribe, pickProvider } from '@/lib/stt/transcribe';
import { getUserState } from '@/lib/db/queries';
import { ensureCaptureDir } from '@/lib/config/paths';

/** Save an audio blob to ~/.flow/captures/<id>.<ext> and return the filename. */
async function saveAudioFile(file: Blob, id: string): Promise<string> {
  const dir = ensureCaptureDir();
  // Derive extension from mime type (audio/webm → webm, audio/mp4 → mp4, etc.)
  const ext = file.type?.split('/')[1]?.split(';')[0] || 'webm';
  const filename = `${id}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(path.join(dir, filename), buf);
  return filename;
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') ?? '';

    let rawText: string;
    let source: 'voice' | 'capture' = 'capture';
    let audioFile: string | undefined;

    if (contentType.includes('multipart/form-data')) {
      // ── Audio path ──
      const formData = await request.formData();
      const file = formData.get('file') as Blob | null;
      const text = formData.get('text') as string | null;

      if (file && file.size > 0) {
        source = 'voice';
        const id = uuidv7();

        // Voice model priority: explicit param → user preference → auto-pick
        const explicitModel = formData.get('voice_model') as string | null;
        let voiceModel: string | null = explicitModel || getUserState()?.voice_model || null;

        // Try to auto-pick if no explicit model
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
            audioFile = await saveAudioFile(file, id);
            rawText = '[Voice memo — transcription failed]';
            console.warn('[POST /api/capture] Transcription failed, audio saved:', audioFile, err);
          }
        } else {
          // No STT provider at all — save audio for later
          audioFile = await saveAudioFile(file, id);
          rawText = '[Voice memo — pending transcription]';
        }

        // Create stream item (with audio_file ref if saved)
        const db = getDb();
        const row = db
          .insert(stream)
          .values({
            id,
            raw_text: rawText,
            source,
            status: 'pending',
            audio_file: audioFile,
            created_at: new Date().toISOString(),
          })
          .returning()
          .get();

        void upsertEmbedding('stream', row.id, buildEmbeddingText('stream', row));
        void syncEntity('stream', row.id);

        return Response.json(
          {
            item: row,
            transcript: !audioFile ? rawText : undefined,
            audio_saved: !!audioFile,
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

    // Create stream item (text path — no audio)
    const db = getDb();
    const row = db
      .insert(stream)
      .values({
        id: uuidv7(),
        raw_text: rawText,
        source,
        status: 'pending',
        created_at: new Date().toISOString(),
      })
      .returning()
      .get();

    void upsertEmbedding('stream', row.id, buildEmbeddingText('stream', row));
    void syncEntity('stream', row.id);

    return Response.json({ item: row }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/capture]', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
