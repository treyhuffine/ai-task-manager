import type { UIMessage } from 'ai';
import { isFileUIPart } from 'ai';

// Provider-side handling of `text/*` file parts is uneven (Anthropic ignores
// some, OpenAI rejects others). Inline them as plain text so the model
// always sees the pasted blob, regardless of provider quirks.

const TEXT_MEDIA_TYPE_ALLOWLIST = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'text/html',
  'application/json',
  'application/xml',
]);

function isTextLikeMediaType(mediaType: string | undefined): boolean {
  if (!mediaType) return false;
  if (mediaType.startsWith('text/')) return true;
  return TEXT_MEDIA_TYPE_ALLOWLIST.has(mediaType);
}

function decodeDataUrl(url: string): string | null {
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

/**
 * Walk UI messages and replace text-typed `FileUIPart`s with `TextUIPart`s
 * wrapped in `<attachment filename="…">…</attachment>` markers. Image / PDF
 * / audio attachments pass through untouched so native multimodal still
 * works.
 */
export function inlineTextAttachments<T extends UIMessage>(messages: T[]): T[] {
  return messages.map((message) => {
    if (!message.parts?.length) return message;

    let touched = false;
    const nextParts: T['parts'] = [];

    for (const part of message.parts) {
      if (isFileUIPart(part) && isTextLikeMediaType(part.mediaType)) {
        const text = decodeDataUrl(part.url);
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
      nextParts.push(part);
    }

    return touched ? ({ ...message, parts: nextParts } as T) : message;
  });
}
