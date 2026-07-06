/**
 * Git merge-conflict marker parsing + resolution serialization.
 *
 * Pure, dependency-free (no node / react) so both the server (the file
 * tree's conflict detection in `list-tree.ts`) and the client (the
 * ConflictView resolver) can share one source of truth. If the tree says
 * a file is a conflict, the ConflictView is guaranteed to find the same
 * blocks — they run the exact same parser.
 *
 * We parse the standard git conflict shape:
 *
 *   <<<<<<< <current-label>
 *   ...current (ours / HEAD) lines...
 *   ||||||| <base-label>        (only in diff3 / zdiff3 conflictStyle)
 *   ...base (common ancestor) lines...
 *   =======
 *   ...incoming (theirs) lines...
 *   >>>>>>> <incoming-label>
 *
 * Markers are matched only at the START of a line and must be exactly
 * seven marker characters (git's format), which keeps prose that merely
 * mentions `<<<<<<<` from tripping detection.
 */

/** How the user chose to resolve a single conflict block. */
export type ConflictResolution = 'current' | 'incoming' | 'both';

export interface ConflictBlock {
  /** Lines between `<<<<<<<` and `|||||||`/`=======` (ours / HEAD). */
  current: string[];
  /** Lines between `=======` and `>>>>>>>` (theirs / incoming). */
  incoming: string[];
  /** Lines between `|||||||` and `=======` (common ancestor). Only
   *  present when the file was written with a diff3-style conflictStyle. */
  base?: string[];
  /** Label after `<<<<<<<` (e.g. `HEAD`). Empty string when absent. */
  currentLabel: string;
  /** Label after `>>>>>>>` (e.g. the incoming branch). Empty when absent. */
  incomingLabel: string;
  /** The block's original lines verbatim, markers included — used to
   *  reproduce an unresolved block byte-for-byte on serialize. */
  raw: string[];
}

export type ConflictSegment =
  | { type: 'context'; lines: string[] }
  | { type: 'conflict'; block: ConflictBlock };

export interface ParsedConflicts {
  segments: ConflictSegment[];
  /** Conflict-block count. `0` means "not a conflict file". */
  count: number;
  /** Whether the source ended with a trailing newline, so a resolved
   *  file can be reproduced with the same final-newline state. */
  trailingNewline: boolean;
}

const CURRENT_MARK = /^<{7}(?: (.*))?$/;
const BASE_MARK = /^\|{7}(?: (.*))?$/;
const SEPARATOR = /^={7}$/;
const INCOMING_MARK = /^>{7}(?: (.*))?$/;

/**
 * Cheap pre-check: does the text contain a line that starts a conflict?
 * Lets callers skip the full split/parse for the overwhelmingly common
 * "no conflict" case. Not a correctness gate — `parseConflicts` still
 * validates full block structure.
 */
export function hasConflictMarkers(content: string): boolean {
  // A start marker is either at the very beginning or after a newline.
  return content.startsWith('<<<<<<<') || content.includes('\n<<<<<<<');
}

function toContentLines(content: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = content.endsWith('\n');
  // Normalize CRLF so marker matching (line-anchored) isn't defeated by a
  // trailing '\r'. We only touch the split copy; re-serialization joins
  // with '\n', which is fine for conflict resolution (git writes '\n').
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  // A trailing newline yields a final '' element; drop it and remember to
  // re-add the newline on serialize.
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

/**
 * Parse `content` into an ordered list of context / conflict segments.
 * Malformed markers (an opener with no matching separator/closer) make
 * the whole file parse as a single context segment with `count === 0`,
 * so a half-written file is treated as "not a conflict" rather than
 * throwing.
 */
export function parseConflicts(content: string): ParsedConflicts {
  const { lines, trailingNewline } = toContentLines(content);
  const notConflict = (): ParsedConflicts => ({
    segments: lines.length ? [{ type: 'context', lines }] : [{ type: 'context', lines: [''] }],
    count: 0,
    trailingNewline,
  });

  if (!hasConflictMarkers(content)) return notConflict();

  const segments: ConflictSegment[] = [];
  let ctx: string[] = [];
  let count = 0;

  const flushContext = () => {
    if (ctx.length) {
      segments.push({ type: 'context', lines: ctx });
      ctx = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const openMatch = CURRENT_MARK.exec(lines[i]);
    if (!openMatch) {
      ctx.push(lines[i]);
      i++;
      continue;
    }

    // ── Start of a conflict block ──
    const raw: string[] = [lines[i]];
    const currentLabel = openMatch[1] ?? '';
    i++;

    const current: string[] = [];
    while (i < lines.length && !BASE_MARK.test(lines[i]) && !SEPARATOR.test(lines[i])) {
      current.push(lines[i]);
      raw.push(lines[i]);
      i++;
    }

    let base: string[] | undefined;
    if (i < lines.length && BASE_MARK.test(lines[i])) {
      raw.push(lines[i]);
      i++;
      base = [];
      while (i < lines.length && !SEPARATOR.test(lines[i])) {
        base.push(lines[i]);
        raw.push(lines[i]);
        i++;
      }
    }

    // Must be sitting on the `=======` separator now.
    if (i >= lines.length || !SEPARATOR.test(lines[i])) return notConflict();
    raw.push(lines[i]);
    i++;

    const incoming: string[] = [];
    while (i < lines.length && !INCOMING_MARK.test(lines[i])) {
      incoming.push(lines[i]);
      raw.push(lines[i]);
      i++;
    }

    const closeMatch = i < lines.length ? INCOMING_MARK.exec(lines[i]) : null;
    if (!closeMatch) return notConflict();
    const incomingLabel = closeMatch[1] ?? '';
    raw.push(lines[i]);
    i++;

    flushContext();
    segments.push({
      type: 'conflict',
      block: { current, incoming, base, currentLabel, incomingLabel, raw },
    });
    count++;
  }

  flushContext();
  return { segments, count, trailingNewline };
}

/**
 * Reconstruct file content from parsed segments given a resolution for
 * each conflict block (indexed in block order). A `null` resolution keeps
 * the block's original markers verbatim, so a partially-resolved file
 * round-trips losslessly.
 *
 *   - `current`  → keep ours only
 *   - `incoming` → keep theirs only
 *   - `both`     → ours followed by theirs (no markers)
 */
export function serializeResolution(
  parsed: ParsedConflicts,
  resolutions: ReadonlyArray<ConflictResolution | null>,
): string {
  const out: string[] = [];
  let blockIdx = 0;
  for (const seg of parsed.segments) {
    if (seg.type === 'context') {
      out.push(...seg.lines);
      continue;
    }
    const choice = resolutions[blockIdx] ?? null;
    blockIdx++;
    out.push(...resolvedLines(seg.block, choice));
  }
  let text = out.join('\n');
  if (parsed.trailingNewline) text += '\n';
  return text;
}

/** The lines a single block contributes for a given resolution. */
export function resolvedLines(
  block: ConflictBlock,
  choice: ConflictResolution | null,
): string[] {
  switch (choice) {
    case 'current':
      return block.current;
    case 'incoming':
      return block.incoming;
    case 'both':
      return [...block.current, ...block.incoming];
    default:
      return block.raw;
  }
}
