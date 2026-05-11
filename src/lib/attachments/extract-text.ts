/**
 * Server-side text extraction from attachment files.
 *
 * The chat code paths use this to convert file attachments into a
 * shape any model can read: plain text wrapped in `<attachment>`
 * tags. Both the orchestrator chat (Anthropic/OpenAI via ai-sdk) and
 * the execution chat (Claude Code subprocess) use it for formats
 * that aren't natively model-readable:
 *
 *   - text/* and code/data files → read utf-8 directly
 *   - .docx (`mammoth`)            → extract raw text
 *   - .xlsx / .xls (`xlsx`)        → CSV per sheet
 *   - audio/*                      → transcribe via STT (parakeet
 *                                    local → groq → openai), if any
 *                                    provider is available
 *   - else                         → null (caller decides whether to
 *                                    skip, fall through to native
 *                                    handling, or warn)
 *
 * Native handling lives in the callers:
 *   - images and PDFs go through the model's multimodal path (URL
 *     for Claude Code Read; base64 for Anthropic/OpenAI APIs)
 *   - plain text could *also* go that route in theory, but inlining
 *     reads more naturally and dodges provider quirks
 */

import fs from 'node:fs/promises';
import { attachmentPath } from './save';
import { transcribe, pickProvider } from '@/lib/stt/transcribe';
import type { Attachment } from '@/db/types';

export interface ExtractResult {
  /** Extracted text. Caller wraps in `<attachment>` tags. */
  text: string;
  /** One-line description of the conversion path, useful in logs. */
  via: string;
}

const DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

const XLSX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const TEXT_INLINE_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'text/html',
  'application/json',
  'application/xml',
  // SVG is XML — neither Anthropic nor OpenAI accept it as an image,
  // and its source is more useful to the model than a rasterized
  // version anyway (the model can reason about shapes + structure).
  'image/svg+xml',
]);

const PPTX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
]);

/**
 * Maximum extracted text we ship to the model per attachment. A
 * large `.docx` or transcript can easily clear 100k chars; truncating
 * keeps a single attachment from blowing the session's context window
 * before the user even sends a message.
 *
 * 200k chars ≈ 50–60k tokens — generous enough that nothing useful
 * gets cut for typical docs, restrictive enough that pathological
 * inputs don't grief.
 */
const MAX_EXTRACTED_CHARS = 200_000;

function maybeTruncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_EXTRACTED_CHARS) return { text, truncated: false };
  const head = text.slice(0, MAX_EXTRACTED_CHARS);
  return {
    text: `${head}\n\n[truncated — original was ${text.length.toLocaleString()} chars; first ${MAX_EXTRACTED_CHARS.toLocaleString()} shown]`,
    truncated: true,
  };
}

/**
 * Try to extract readable text from an attachment. Returns null when
 * the type isn't supported (caller decides next step).
 *
 * Extension-sniffs as a backup to mime — browsers often misreport
 * docx/xlsx as `application/octet-stream` or `application/zip`.
 */
export async function extractTextFromAttachment(
  attachment: Attachment,
): Promise<ExtractResult | null> {
  const result = await extractRaw(attachment);
  if (!result) return null;
  const { text, truncated } = maybeTruncate(result.text);
  return {
    text,
    via: truncated ? `${result.via} (truncated)` : result.via,
  };
}

async function extractRaw(attachment: Attachment): Promise<ExtractResult | null> {
  const path = attachmentPath(attachment.file_name);
  const mime = attachment.mime_type;
  const lowerName = (attachment.original_name || attachment.file_name).toLowerCase();

  // ─── Plain text family (incl. SVG as XML) ─────────────────
  if (mime.startsWith('text/') || TEXT_INLINE_MIMES.has(mime)) {
    const text = await fs.readFile(path, 'utf8');
    return { text, via: mime === 'image/svg+xml' ? 'svg → source' : 'utf8' };
  }

  // ─── DOCX ────────────────────────────────────────────────
  if (DOCX_MIMES.has(mime) || lowerName.endsWith('.docx')) {
    // mammoth's `convertToHtml` preserves structure (headings, lists,
    // tables) but the HTML noise is more than most LLM prompts want.
    // Raw text is closer to what a human would copy out of Word and
    // paste into chat. Tables become tab-separated lines, which
    // models read well enough.
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ path });
    return { text: result.value, via: 'docx → text' };
  }

  // ─── XLSX / XLS ──────────────────────────────────────────
  if (
    XLSX_MIMES.has(mime) ||
    lowerName.endsWith('.xlsx') ||
    lowerName.endsWith('.xls') ||
    lowerName.endsWith('.ods')
  ) {
    // CSV-per-sheet keeps the model's tokenizer happy and preserves
    // column relationships. Skip blank sheets so a workbook with one
    // populated tab doesn't bury the model in empty headers.
    //
    // SheetJS 0.20+ (the CVE-2023-30533 patched line from the official
    // CDN) requires the consumer to bind `fs` explicitly — drops the
    // implicit Node dep so the same package works in edge runtimes.
    // We do it once per call rather than at module load to keep the
    // import lazy.
    const XLSX = await import('xlsx');
    const nodeFs = await import('node:fs');
    XLSX.set_fs(nodeFs);
    const wb = XLSX.readFile(path);
    const chunks: string[] = [];
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet).trim();
      if (!csv) continue;
      chunks.push(`## Sheet: ${name}\n${csv}`);
    }
    return { text: chunks.join('\n\n'), via: 'xlsx → csv' };
  }

  // ─── PPTX / PPT (and ODP/ODT for free) ───────────────────
  if (
    PPTX_MIMES.has(mime) ||
    lowerName.endsWith('.pptx') ||
    lowerName.endsWith('.ppt') ||
    lowerName.endsWith('.odp') ||
    lowerName.endsWith('.odt')
  ) {
    // officeparser handles the full OOXML / ODF family from a single
    // dep. Returns an AST; `.toText()` flattens to plain text with
    // slide / section boundaries preserved as newlines.
    const { parseOffice } = await import('officeparser');
    const ast = await parseOffice(path);
    return { text: ast.toText(), via: 'office → text' };
  }

  // ─── Audio (STT) ─────────────────────────────────────────
  if (mime.startsWith('audio/')) {
    let provider: string;
    try {
      provider = await pickProvider();
    } catch {
      // Caller will see null and decide how to surface "no STT
      // available" — most likely a "(no transcript: STT offline)"
      // marker. We don't throw because that would break the whole
      // message.
      return null;
    }
    try {
      const bytes = await fs.readFile(path);
      // Reuse the existing transcribe() path so all four providers
      // (parakeet local, groq, openai, web) flow through one place.
      // The Blob constructor preserves byte content; the file's mime
      // helps the provider pick a decoder.
      const blob = new Blob([new Uint8Array(bytes)], { type: mime });
      const text = await transcribe(blob, provider);
      if (!text.trim()) return null;
      return { text: text.trim(), via: `audio → ${provider}` };
    } catch (err) {
      console.warn(`[extract-text] STT failed for ${attachment.file_name}:`, err);
      return null;
    }
  }

  return null;
}

/**
 * Format an extracted attachment for prompt inclusion. Wrapped in
 * `<attachment>` tags so the model can identify the boundary, with
 * filename + extraction-method metadata.
 *
 * Audio gets a `kind="audio-transcript"` hint so models know they're
 * looking at STT output (potentially imperfect) rather than the
 * source bytes.
 */
export function formatExtractedAttachment(
  attachment: Attachment,
  result: ExtractResult,
): string {
  const filename = escapeAttr(attachment.original_name || attachment.file_name);
  const kindAttr = result.via.startsWith('audio →') ? ' kind="audio-transcript"' : '';
  return `<attachment filename="${filename}"${kindAttr}>\n${result.text}\n</attachment>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
