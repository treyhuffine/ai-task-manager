/**
 * Document-aware extraction over the shared `[[kind:id]]` grammar
 * (parse-markers.ts). Markers inside inline code spans or fenced code
 * blocks are NOT links (a `[[note:id]]` shown as an example is literal
 * text). This layer masks code regions first, then applies the grammar.
 *
 * One shared layer so the three consumers can never disagree:
 *   - link derivation (derive-links.ts / queries.ts),
 *   - the markdown mirror rewrite (export/mirror),
 *   - the Tiptap editor tokenizer.
 *
 * The raw parser (parse-markers.ts) is deliberately left untouched — chat
 * relies on its unconditional behavior.
 *
 * Design notes:
 *   - Masking preserves length (code chars → spaces), so marker offsets in
 *     the masked string line up 1:1 with the original. `rewriteEntityMarkers`
 *     depends on that to splice replacements back into the original text.
 *   - Only fenced (``` / ~~~) and inline (`...`) code are masked. 4-space
 *     indented code blocks are intentionally not masked: they are ambiguous
 *     with nested list content and Tiptap emits fenced blocks, so masking
 *     them would risk hiding legitimately-indented prose.
 */

import {
  parseEntitySegments,
  listNonFileMarkers,
  type EntityMarker,
} from './parse-markers';

export type NonFileMarker = Exclude<EntityMarker, { kind: 'file' }>;

/** Replace inline code spans on a single line with equal-length spaces. */
function maskInlineCode(line: string): string {
  // A run of N backticks opens, the nearest run of the same length closes.
  return line.replace(/(`+)[^\n]*?\1/g, (m) => ' '.repeat(m.length));
}

/**
 * Blank out fenced code blocks and inline code, preserving total length so
 * offsets stay aligned with the original text.
 */
export function maskCodeRegions(text: string): string {
  const lines = text.split('\n');
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inFence) {
      const open = line.match(/^\s*(`{3,}|~{3,})/);
      if (open) {
        inFence = true;
        fenceChar = open[1][0];
        fenceLen = open[1].length;
        lines[i] = ' '.repeat(line.length);
      } else {
        lines[i] = maskInlineCode(line);
      }
    } else {
      const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      lines[i] = ' '.repeat(line.length);
      // CommonMark: the closing fence must use the same character and be at
      // least as long as the opening one — a ``` line does not close a ```` fence.
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
      }
    }
  }
  return lines.join('\n');
}

/** Every task/note/scratchpad marker outside code, in document order. */
export function extractEntityMarkers(text: string | null | undefined): NonFileMarker[] {
  if (!text) return [];
  return listNonFileMarkers(maskCodeRegions(text));
}

/**
 * Rewrite task/note markers outside code via `replace`. Returning `null`
 * leaves the marker verbatim. File and scratchpad markers are always left
 * verbatim. Markers inside code are never touched.
 */
export function rewriteEntityMarkers(
  text: string | null | undefined,
  replace: (marker: { kind: 'task' | 'note'; id: string }) => string | null,
): string {
  if (!text) return text ?? '';
  const masked = maskCodeRegions(text); // equal length → offsets align
  let out = '';
  let offset = 0;
  for (const seg of parseEntitySegments(masked)) {
    const len = seg.kind === 'text' ? seg.text.length : seg.raw.length;
    const original = text.slice(offset, offset + len);
    if (seg.kind === 'marker' && (seg.marker.kind === 'task' || seg.marker.kind === 'note')) {
      const replacement = replace({ kind: seg.marker.kind, id: seg.marker.id });
      out += replacement ?? original;
    } else {
      out += original;
    }
    offset += len;
  }
  return out;
}
