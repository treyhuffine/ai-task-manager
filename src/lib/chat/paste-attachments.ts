import type { FileUIPart } from 'ai';
import { uuidv7 } from 'uuidv7';

const PASTED_TEXT_MEDIA_TYPES = new Set(['text/plain', 'text/markdown', 'text/x-markdown', 'text/csv']);

// Pasted text exceeding either threshold is converted to an attachment chip
// rather than dropped raw into the textarea. Tuned to match what most AI
// chat apps do — long enough that small snippets stay inline, short enough
// that a stack trace or log dump becomes a chip.
export const PASTE_AS_FILE_CHAR_THRESHOLD = 1500;
export const PASTE_AS_FILE_LINE_THRESHOLD = 30;
export const PASTED_TEXT_MEDIA_TYPE = 'text/plain';

export interface PasteAttachment {
  id: string;
  filename: string;
  content: string;
  /** Byte size of the UTF-8 encoded content. */
  size: number;
  createdAt: number;
}

export function shouldConvertPasteToAttachment(text: string): boolean {
  if (!text) return false;
  if (text.length > PASTE_AS_FILE_CHAR_THRESHOLD) return true;

  let newlines = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      newlines++;
      if (newlines >= PASTE_AS_FILE_LINE_THRESHOLD) return true;
    }
  }
  return false;
}

export function createPasteAttachment(
  content: string,
  index: number,
): PasteAttachment {
  return {
    id: uuidv7(),
    filename: `Pasted-${index}.txt`,
    content,
    size: new Blob([content]).size,
    createdAt: Date.now(),
  };
}

// Browser-safe UTF-8 → base64 encoder. `btoa` only handles latin1, so we
// route through TextEncoder first to preserve emoji/CJK/etc.
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function textToDataUrl(
  content: string,
  mediaType: string = PASTED_TEXT_MEDIA_TYPE,
): string {
  return `data:${mediaType};base64,${utf8ToBase64(content)}`;
}

export function attachmentsToFileUIParts(
  attachments: PasteAttachment[],
): FileUIPart[] {
  return attachments.map((a) => ({
    type: 'file',
    mediaType: PASTED_TEXT_MEDIA_TYPE,
    filename: a.filename,
    url: textToDataUrl(a.content),
  }));
}

export function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 100) return `${(size / 1024).toFixed(1)} KB`;
  return `${Math.round(size / 1024)} KB`;
}

export function formatAttachmentLineCount(content: string): number {
  if (!content) return 0;
  let lines = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lines++;
  }
  return lines;
}

// Browser-safe inverse of textToDataUrl. Returns null for non-decodable URLs.
export function dataUrlToText(dataUrl: string): string | null {
  if (!dataUrl.startsWith('data:')) return null;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return null;

  const meta = dataUrl.substring(5, commaIdx);
  const payload = dataUrl.substring(commaIdx + 1);
  const isBase64 = meta.split(';').includes('base64');

  try {
    if (isBase64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

// True when the file part is a pasted-text-like payload we should render as
// an expandable chip instead of e.g. an image or PDF.
export function isPastedTextFilePart(part: FileUIPart): boolean {
  return PASTED_TEXT_MEDIA_TYPES.has(part.mediaType) || part.mediaType.startsWith('text/');
}

export function fileUIPartToAttachment(
  part: FileUIPart,
  fallbackId: string,
): PasteAttachment | null {
  const content = dataUrlToText(part.url);
  if (content == null) return null;
  return {
    id: fallbackId,
    filename: part.filename ?? 'attachment.txt',
    content,
    size: new Blob([content]).size,
    createdAt: 0,
  };
}
