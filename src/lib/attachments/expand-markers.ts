/**
 * Expand `[[file:<fileName>]]` markers in a user-prompt string into
 * the agent-readable form. Two outcomes per marker:
 *
 *   - For mimes Claude Code's Read tool handles natively (text, code,
 *     images, PDF, JSON, XML): replace the marker with the file's
 *     absolute disk path. The agent opens it via its existing file
 *     tooling.
 *   - For non-natively-readable mimes (docx, xlsx, audio): extract
 *     to text and inline it wrapped in `<attachment>` tags so the
 *     agent sees the content directly.
 *
 * Used by:
 *   - `POST /api/sessions/[id]/messages` — expands content before
 *     handing it to `executor.dispatch`.
 *   - `executor.dispatch`'s drain loop — re-expands each queued
 *     `chat_events` row at drain time so attachments queued mid-turn
 *     are inlined into the follow-up prompt the agent actually sees.
 *
 * The stored row keeps the marker form (compact); only the prompt
 * stream the agent sees gets the expanded form.
 */

import { attachmentPath } from './save';
import { extractTextFromAttachment, formatExtractedAttachment } from './extract-text';
import type { Attachment } from '@/db/types';

const MARKER_RE = /\[\[file:([A-Za-z0-9_.-]+)\]\]/g;

function claudeCodeReadsNatively(mime: string): boolean {
  if (mime.startsWith('text/')) return true;
  if (mime.startsWith('image/')) return true;
  if (mime === 'application/pdf') return true;
  if (mime === 'application/json' || mime === 'application/xml') return true;
  return false;
}

export async function expandMarkers(content: string, attachments: Attachment[]): Promise<string> {
  if (attachments.length === 0) return content;
  const map = new Map<string, Attachment>(attachments.map((a) => [a.fileName, a]));

  // Two-pass: collect every match, resolve replacements concurrently
  // (mammoth/xlsx/STT can be slow), then splice. `String#replace` has
  // no async overload — this is the standard workaround.
  const matches: Array<{ start: number; end: number; replacement: string }> = [];
  const tasks: Promise<void>[] = [];
  for (const m of content.matchAll(MARKER_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const fileName = m[1]!;
    const a = map.get(fileName);
    if (!a) {
      matches.push({ start, end, replacement: m[0] });
      continue;
    }
    if (claudeCodeReadsNatively(a.mimeType)) {
      matches.push({ start, end, replacement: attachmentPath(a.fileName) });
      continue;
    }
    const slot = matches.length;
    matches.push({ start, end, replacement: m[0] });
    tasks.push(
      (async () => {
        try {
          const result = await extractTextFromAttachment(a);
          matches[slot]!.replacement = result
            ? formatExtractedAttachment(a, result)
            : `<attachment filename="${a.originalName || a.fileName}" status="unreadable" />`;
        } catch (err) {
          console.warn(`[expandMarkers] extract failed for ${a.fileName}:`, err);
          matches[slot]!.replacement = `<attachment filename="${a.originalName || a.fileName}" status="extract-error" />`;
        }
      })(),
    );
  }
  await Promise.all(tasks);

  let out = content;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;
    out = out.slice(0, m.start) + m.replacement + out.slice(m.end);
  }
  return out;
}
