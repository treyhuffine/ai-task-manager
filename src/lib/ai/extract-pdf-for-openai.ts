/**
 * OpenAI's chat models don't accept PDFs the way Anthropic does
 * (Anthropic decomposes them into text + per-page images natively).
 * For the OpenAI provider path we extract PDF text server-side via
 * `pdf-parse` and inline it as `<attachment>` tags before the
 * generic file-part rewrite runs.
 *
 * Anthropic skips this step — its PDF support is better than what
 * `pdf-parse` extracts (per-page images preserve charts, layouts,
 * scanned content).
 *
 * Lazy-imports `pdf-parse` so the dep doesn't load on Anthropic-only
 * deployments.
 */

import type { UIMessage } from 'ai';
import { isFileUIPart } from 'ai';
import fs from 'node:fs/promises';
import { attachmentPath } from '@/lib/attachments/save';
import { fileNameFromUrl } from '@/lib/chat/file-ui-part';

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const MAX_PDF_TEXT_CHARS = 200_000;

async function extractPdfText(absolutePath: string): Promise<string | null> {
  try {
    // unpdf wraps Mozilla's pdf.js with zero native deps so the same
    // code runs on Node, Vercel, Lambda, and Cloudflare Workers. The
    // two-step API (getDocumentProxy → extractText) lets the underlying
    // doc be reused for metadata or per-page extraction; we only need
    // the merged text.
    const { extractText, getDocumentProxy } = await import('unpdf');
    const bytes = await fs.readFile(absolutePath);
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (trimmed.length <= MAX_PDF_TEXT_CHARS) return trimmed;
    return `${trimmed.slice(0, MAX_PDF_TEXT_CHARS)}\n\n[truncated: original PDF text was ${trimmed.length.toLocaleString()} chars]`;
  } catch (err) {
    console.warn('[extract-pdf-for-openai] failed:', err);
    return null;
  }
}

/**
 * Walk messages, replacing each PDF file part with a text part
 * carrying the extracted content. Non-PDF parts pass through
 * unchanged (the generic `inlineTextAttachments` handles them).
 */
export async function extractPdfsForOpenAI<T extends UIMessage>(messages: T[]): Promise<T[]> {
  const out: T[] = [];
  for (const message of messages) {
    if (!message.parts?.length) {
      out.push(message);
      continue;
    }
    let touched = false;
    const nextParts: T['parts'] = [];
    for (const part of message.parts) {
      if (!isFileUIPart(part) || part.mediaType !== 'application/pdf') {
        nextParts.push(part);
        continue;
      }

      // Two source paths: an internal /api/attachments URL (most
      // editor uploads) or a base64 data URL (legacy / external
      // sources). Handle both.
      let absolutePath: string | null = null;
      if (part.url.startsWith('data:')) {
        // Decode + write to a tmp file so pdf-parse can read it.
        // This branch is rare; the editor emits internal URLs.
        const commaIdx = part.url.indexOf(',');
        if (commaIdx === -1) {
          nextParts.push(part);
          continue;
        }
        const payload = part.url.slice(commaIdx + 1);
        const bytes = Buffer.from(payload, 'base64');
        const os = await import('node:os');
        const path = await import('node:path');
        const tmpFile = path.join(os.tmpdir(), `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`);
        await fs.writeFile(tmpFile, bytes);
        absolutePath = tmpFile;
      } else {
        const fileName = fileNameFromUrl(part.url);
        if (fileName) absolutePath = attachmentPath(fileName);
      }

      if (!absolutePath) {
        nextParts.push(part);
        continue;
      }

      const text = await extractPdfText(absolutePath);
      if (text) {
        const filename = part.filename ?? 'document.pdf';
        nextParts.push({
          type: 'text',
          text: `<attachment filename="${escapeAttr(filename)}" kind="pdf-text">\n${text}\n</attachment>`,
        } as T['parts'][number]);
        touched = true;
      } else {
        // Couldn't extract — drop with a marker rather than send a
        // PDF the OpenAI model will reject.
        nextParts.push({
          type: 'text',
          text: `<attachment filename="${escapeAttr(part.filename ?? 'document.pdf')}" status="unreadable" />`,
        } as T['parts'][number]);
        touched = true;
      }
    }
    out.push(touched ? ({ ...message, parts: nextParts } as T) : message);
  }
  return out;
}
