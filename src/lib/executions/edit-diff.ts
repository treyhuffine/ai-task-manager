/**
 * Derive a renderable diff (+/− counts and lines) for a file-editing tool
 * call, straight from its input — no git, no API. Covers:
 *
 *   - Claude `Edit`  (`old_string` → `new_string`, line-level LCS diff)
 *   - Claude `MultiEdit` (sum of per-edit diffs)
 *   - Claude `Write` (new/overwritten content → additions)
 *   - Claude `NotebookEdit` (treated like Edit)
 *   - Codex `apply_patch` (parse the V4A patch body's +/−/ctx lines)
 *
 * Pure + bounded (LCS is capped; huge inputs degrade to whole-block
 * replace) so it renders inline and unit-tests cleanly. For the precise
 * cumulative diff-vs-base, the file viewer uses the git diff API; this is
 * the cheap per-edit view that powers the chip badge + hover/expand.
 */

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx';
  text: string;
}

export interface EditDiff {
  /** Path from the tool input (absolute or relative), if present. */
  path?: string;
  kind: 'edit' | 'write' | 'patch';
  additions: number;
  deletions: number;
  /** Renderable hunk. Empty when the diff is too large to show inline. */
  lines: DiffLine[];
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

const MAX_LCS_CELLS = 1_000_000; // ~1000×1000 lines; beyond this, degrade.
const MAX_RENDER_LINES = 400;

/** Line-level LCS diff of two blocks. Degrades to del-all/add-all when big. */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.length ? oldText.split('\n') : [];
  const b = newText.length ? newText.split('\n') : [];
  if (a.length * b.length > MAX_LCS_CELLS) {
    return [
      ...a.map((text): DiffLine => ({ kind: 'del', text })),
      ...b.map((text): DiffLine => ({ kind: 'add', text })),
    ];
  }
  // LCS table.
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: 'ctx', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', text: a[i] });
      i++;
    } else {
      out.push({ kind: 'add', text: b[j] });
      j++;
    }
  }
  while (i < m) out.push({ kind: 'del', text: a[i++] });
  while (j < n) out.push({ kind: 'add', text: b[j++] });
  return out;
}

/** One aligned row of a two-column (side-by-side) diff. */
export interface SplitRow {
  left: { lineNo: number | null; text: string | null; kind: 'del' | 'ctx' | 'empty' };
  right: { lineNo: number | null; text: string | null; kind: 'add' | 'ctx' | 'empty' };
}

/**
 * Re-shape the unified `lineDiff` into aligned side-by-side rows. Consecutive
 * deletions/additions are paired index-by-index (old line ↔ new line on one
 * row); leftover deletions render left-only, leftover additions right-only,
 * with a filler cell on the empty side. Context lines occupy both columns.
 * Reuses `lineDiff`'s LCS so the two views never disagree.
 */
export function splitDiff(oldText: string, newText: string): SplitRow[] {
  const lines = lineDiff(oldText, newText);
  const rows: SplitRow[] = [];
  let leftNo = 0;
  let rightNo = 0;
  let pendingDel: string[] = [];
  let pendingAdd: string[] = [];

  const flush = () => {
    const max = Math.max(pendingDel.length, pendingAdd.length);
    for (let k = 0; k < max; k++) {
      const d = k < pendingDel.length ? pendingDel[k] : null;
      const a = k < pendingAdd.length ? pendingAdd[k] : null;
      rows.push({
        left: d !== null
          ? { lineNo: ++leftNo, text: d, kind: 'del' }
          : { lineNo: null, text: null, kind: 'empty' },
        right: a !== null
          ? { lineNo: ++rightNo, text: a, kind: 'add' }
          : { lineNo: null, text: null, kind: 'empty' },
      });
    }
    pendingDel = [];
    pendingAdd = [];
  };

  for (const l of lines) {
    if (l.kind === 'del') pendingDel.push(l.text);
    else if (l.kind === 'add') pendingAdd.push(l.text);
    else {
      flush();
      leftNo++;
      rightNo++;
      rows.push({
        left: { lineNo: leftNo, text: l.text, kind: 'ctx' },
        right: { lineNo: rightNo, text: l.text, kind: 'ctx' },
      });
    }
  }
  flush();
  return rows;
}

function countAndCap(lines: DiffLine[]): EditDiff['lines'] & { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const l of lines) {
    if (l.kind === 'add') additions++;
    else if (l.kind === 'del') deletions++;
  }
  const rendered = lines.length > MAX_RENDER_LINES ? [] : lines;
  return Object.assign(rendered, { additions, deletions });
}

/** Parse a V4A `apply_patch` body into diff lines (across all files). */
function patchDiff(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('*** ') || raw.startsWith('@@')) continue; // headers
    if (raw.startsWith('+++') || raw.startsWith('---')) continue; // unified file markers
    if (raw.startsWith('+')) out.push({ kind: 'add', text: raw.slice(1) });
    else if (raw.startsWith('-')) out.push({ kind: 'del', text: raw.slice(1) });
    else if (raw.startsWith(' ')) out.push({ kind: 'ctx', text: raw.slice(1) });
    // bare lines (e.g. "No newline at end of file") are ignored
  }
  return out;
}

function firstPatchFile(patch: string): string | undefined {
  const m = patch.match(/^\*\*\*\s+(?:Add|Update|Delete) File:\s+(.+)$/m);
  return m ? m[1].trim() : undefined;
}

export function computeEditDiff(
  toolName: string | null | undefined,
  input: unknown,
): EditDiff | null {
  const name = (toolName ?? '').trim();
  const o = asRecord(input);

  switch (name) {
    case 'Edit':
    case 'NotebookEdit': {
      const oldS = str(o.old_string) ?? '';
      const newS = str(o.new_string) ?? str(o.new_source) ?? '';
      if (!oldS && !newS) return null;
      const c = countAndCap(lineDiff(oldS, newS));
      return { path: str(o.file_path) ?? str(o.notebook_path), kind: 'edit', additions: c.additions, deletions: c.deletions, lines: c };
    }
    case 'MultiEdit': {
      const edits = Array.isArray(o.edits) ? o.edits : [];
      const all: DiffLine[] = [];
      for (const e of edits) {
        const er = asRecord(e);
        all.push(...lineDiff(str(er.old_string) ?? '', str(er.new_string) ?? ''));
      }
      if (!all.length) return null;
      const c = countAndCap(all);
      return { path: str(o.file_path), kind: 'edit', additions: c.additions, deletions: c.deletions, lines: c };
    }
    case 'Write': {
      const content = str(o.content) ?? str(o.contents) ?? '';
      const lines = content.length ? content.split('\n') : [];
      const diffLines: DiffLine[] = lines.map((text) => ({ kind: 'add', text }));
      const c = countAndCap(diffLines);
      return { path: str(o.file_path) ?? str(o.path), kind: 'write', additions: c.additions, deletions: c.deletions, lines: c };
    }
    case 'apply_patch': {
      const patch = typeof input === 'string' ? input : str(o.input) ?? str(o.patch);
      if (!patch) return null;
      const c = countAndCap(patchDiff(patch));
      return { path: firstPatchFile(patch), kind: 'patch', additions: c.additions, deletions: c.deletions, lines: c };
    }
    default:
      return null;
  }
}

/** Tools whose input we can render a per-edit diff for. */
export function isEditTool(toolName: string | null | undefined): boolean {
  return (
    toolName === 'Edit' ||
    toolName === 'MultiEdit' ||
    toolName === 'Write' ||
    toolName === 'NotebookEdit' ||
    toolName === 'apply_patch'
  );
}
