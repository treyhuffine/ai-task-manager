/**
 * Expand `[[file:<fileName>]]` markers in a user-prompt string into
 * the agent-readable form. Two outcomes per marker:
 *
 *   - For a file with text Ri can extract (docx, xlsx, pptx, audio): extract
 *     it and inline it wrapped in `<attachment>` tags so the agent sees the
 *     content directly. Extraction runs at home, wherever the chat runs. An
 *     Office document that arrived labeled as its zip container is still
 *     extracted, by its name.
 *   - For any other file, of any type: the marker stays. `executor.dispatch`
 *     turns it into the file's path on the device the chat runs on, which
 *     only it knows: the home's attachments directory, or a connected
 *     device's copy (`markers.ts`, docs/homes-build.md P2.5). The agent opens
 *     it with its own tools.
 *
 * Used by `POST /api/sessions/[id]/messages` and the health check's orphan
 * re-fire, each before handing the text and its attachments to
 * `executor.dispatch`.
 *
 * The stored row keeps the marker form (compact); only the prompt
 * stream the agent sees gets the expanded form.
 */

import { extractTextFromAttachment, formatExtractedAttachment } from './extract-text';
import { FILE_MARKER_RE, readsNatively } from './markers';
import type { Attachment } from '@/db/types';

export async function expandMarkers(content: string, attachments: Attachment[]): Promise<string> {
  if (attachments.length === 0) return content;
  const map = new Map<string, Attachment>(attachments.map((a) => [a.fileName, a]));

  // Two-pass: collect every match, resolve replacements concurrently
  // (mammoth/xlsx/STT can be slow), then splice. `String#replace` has
  // no async overload — this is the standard workaround.
  const matches: Array<{ start: number; end: number; replacement: string }> = [];
  const tasks: Promise<void>[] = [];
  for (const m of content.matchAll(FILE_MARKER_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const fileName = m[1]!;
    const a = map.get(fileName);
    if (!a || readsNatively(a.mimeType)) {
      matches.push({ start, end, replacement: m[0] });
      continue;
    }
    const slot = matches.length;
    matches.push({ start, end, replacement: m[0] });
    tasks.push(
      (async () => {
        try {
          const result = await extractTextFromAttachment(a);
          // Nothing to extract. The marker stays, and becomes the file's path.
          if (!result) return;
          matches[slot]!.replacement = formatExtractedAttachment(a, result);
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
