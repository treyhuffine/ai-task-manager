import type { UIMessage } from 'ai';
import { isFileUIPart } from 'ai';
import fs from 'node:fs/promises';
import { attachmentPath } from '@/lib/attachments/save';
import { fileNameFromUrl } from '@/lib/chat/file-ui-part';
import {
  extractTextFromAttachment, formatExtractedAttachment,
} from '@/lib/attachments/extract-text';
import { normalizeImageForApi } from '@/lib/attachments/normalize-image';
import type { Attachment } from '@/db/types';

// Provider-side handling of file parts is uneven:
//   - text/* — Anthropic ignores some, OpenAI rejects others, so we
//     inline as plain text wrapped in `<attachment>` tags.
//   - image/* — both providers accept inline base64 reliably; URL
//     handoff requires a publicly fetchable URL, which our internal
//     `/api/attachments/...` route is not.
//   - application/pdf — Anthropic supports inline base64 PDFs.
//   - docx/xlsx/audio — neither provider reads these natively, so we
//     extract text server-side (mammoth/xlsx/STT) and inline.
//
// Editor-emitted file parts use our internal URL pattern, so we
// resolve them to disk paths and either inline as text or re-encode
// as base64 data URLs (image/PDF). Truly unfetchable parts are
// dropped with a warning rather than sent as broken refs.

const INLINE_BASE64_MEDIA_PREFIXES = ['image/', 'application/pdf'];

// SVG is `image/*` but Anthropic rejects it. The extractor inlines
// it as XML text instead, so we explicitly keep it out of the base64
// path even if extraction returned null upstream.
const BASE64_DENYLIST = new Set(['image/svg+xml']);

function shouldInlineBase64(mediaType: string | undefined): boolean {
  if (!mediaType) return false;
  if (BASE64_DENYLIST.has(mediaType)) return false;
  return INLINE_BASE64_MEDIA_PREFIXES.some((p) => mediaType === p || mediaType.startsWith(p));
}

function decodeDataUrlToText(url: string): string | null {
  if (!url.startsWith('data:')) return null;
  const commaIdx = url.indexOf(',');
  if (commaIdx === -1) return null;
  const meta = url.substring(5, commaIdx);
  const payload = url.substring(commaIdx + 1);
  const isBase64 = meta.split(';').includes('base64');
  try {
    if (isBase64) return Buffer.from(payload, 'base64').toString('utf8');
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

async function readAttachmentBytes(url: string): Promise<Buffer | null> {
  const fileName = fileNameFromUrl(url);
  if (!fileName) return null;
  try {
    return await fs.readFile(attachmentPath(fileName));
  } catch (err) {
    console.warn(`[inline-text-attachments] failed to read ${fileName}:`, err);
    return null;
  }
}

/**
 * Build a synthetic Attachment record from a `FileUIPart` so the
 * shared extractor can take it. Size is unknown at this layer (the
 * file part doesn't carry it); zero is fine — the extractor doesn't
 * use it.
 */
function attachmentFromPart(url: string, part: { mediaType?: string; filename?: string }): Attachment | null {
  const file_name = fileNameFromUrl(url);
  if (!file_name) return null;
  return {
    file_name,
    original_name: part.filename ?? file_name,
    mime_type: part.mediaType ?? 'application/octet-stream',
    size: 0,
    uploaded_at: '',
  };
}

/**
 * Walk UI messages and rewrite `FileUIPart`s the providers won't be
 * able to fetch:
 *
 *   - text-like (text/*, json, xml, html, csv) → utf-8 read and
 *     inline as `<attachment>` text
 *   - docx / xlsx → mammoth / xlsx → CSV inline as `<attachment>`
 *   - audio/* → STT (parakeet local → groq → openai → web), inline
 *     as `<attachment kind="audio-transcript">`
 *   - image / PDF parts pointing at an internal URL → base64 data
 *     URL (Anthropic and OpenAI accept inline base64 for these)
 *
 * Already-base64 image/PDF parts pass through. Truly unfetchable
 * parts (binary with internal URL, no on-disk file, or audio with
 * no STT provider) are dropped with a warning so the model doesn't
 * see a broken reference.
 */
export async function inlineTextAttachments<T extends UIMessage>(messages: T[]): Promise<T[]> {
  const out: T[] = [];
  for (const message of messages) {
    if (!message.parts?.length) {
      out.push(message);
      continue;
    }

    let touched = false;
    const nextParts: T['parts'] = [];

    for (const part of message.parts) {
      if (!isFileUIPart(part)) {
        nextParts.push(part);
        continue;
      }

      // Legacy data-URL text parts (kept for back-compat with any
      // callers still emitting data URLs). Native path below for new
      // editor-emitted internal URLs.
      if (
        part.url.startsWith('data:') &&
        (part.mediaType?.startsWith('text/') || part.mediaType === 'application/json')
      ) {
        const text = decodeDataUrlToText(part.url);
        if (text != null) {
          const filename = part.filename ?? 'attachment.txt';
          nextParts.push({
            type: 'text',
            text: `<attachment filename="${escapeAttr(filename)}">\n${text}\n</attachment>`,
          } as T['parts'][number]);
          touched = true;
          continue;
        }
      }

      // Internal-URL parts: try the shared extractor first. Handles
      // text, code, docx, xlsx, audio. Returns null for image/PDF/
      // unknown — those flow into the base64 path below.
      if (!part.url.startsWith('data:')) {
        const att = attachmentFromPart(part.url, part);
        if (att) {
          const result = await extractTextFromAttachment(att);
          if (result) {
            nextParts.push({
              type: 'text',
              text: formatExtractedAttachment(att, result),
            } as T['parts'][number]);
            touched = true;
            continue;
          }
        }
      }

      // Image / PDF attachments: read + base64-encode in place so the
      // provider can forward natively. Images go through
      // `normalizeImageForApi` first to handle HEIC→JPEG conversion
      // and downscale to under Anthropic's 5 MiB / 8000px limits.
      if (shouldInlineBase64(part.mediaType) && !part.url.startsWith('data:')) {
        const bytes = await readAttachmentBytes(part.url);
        if (bytes) {
          let outMime = part.mediaType ?? 'application/octet-stream';
          let outBytes = bytes;
          if (outMime.startsWith('image/')) {
            try {
              const normalized = await normalizeImageForApi(bytes, outMime);
              outMime = normalized.mime;
              outBytes = normalized.bytes;
            } catch (err) {
              console.warn(`[inline-text-attachments] image normalize failed for ${part.url}:`, err);
              // Fall through with original bytes — Anthropic might
              // still accept it. Better than dropping silently.
            }
          }
          const dataUrl = `data:${outMime};base64,${outBytes.toString('base64')}`;
          nextParts.push({ ...part, mediaType: outMime, url: dataUrl } as T['parts'][number]);
          touched = true;
          continue;
        }
        // File missing on disk — drop it rather than send a broken URL.
        console.warn(`[inline-text-attachments] dropping unresolvable file part: ${part.url}`);
        touched = true;
        continue;
      }

      // Anything else (e.g., audio with no STT provider, unknown
      // binary) — drop with a warning rather than send an
      // unfetchable internal URL the provider will choke on.
      if (!part.url.startsWith('data:')) {
        console.warn(`[inline-text-attachments] dropping unsupported part: ${part.mediaType} ${part.url}`);
        touched = true;
        continue;
      }

      nextParts.push(part);
    }

    out.push(touched ? ({ ...message, parts: nextParts } as T) : message);
  }
  return out;
}
