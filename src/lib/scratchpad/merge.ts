/**
 * The scratchpad is one document a person edits from any device
 * (docs/scratchpad.md, "Every device"). Each save says which text it started
 * from (`base`). When the stored text has moved on since, another device
 * wrote in between, and the two are merged here instead of the later save
 * replacing the earlier one.
 *
 * A three-way merge by line (diff3): lines both sides kept line them up, and
 * between them each stretch takes whichever side changed it, so an edit on
 * one device and an edit elsewhere on the other both land where they were
 * made, and a line one side removed stays removed. Where both changed the
 * same stretch, the stored text's version comes first, then what this side
 * wrote that it doesn't already have. Nothing typed is lost. Blank lines are
 * kept, since the editor writes an empty paragraph as one.
 */

/** A scratchpad holds working memory, not documents. Far above real use. */
export const SCRATCHPAD_MAX_LENGTH = 200_000;

/** Past this, two versions are too far apart to line up line by line, and
 *  this side's new lines are added after the stored text instead. */
const MAX_COMPARISONS = 1_000_000;

export function mergeScratchpad(base: string, local: string, remote: string): string {
  if (local === base || local === remote) return remote;
  if (remote === base) return local;
  const o = base.split('\n');
  const a = local.split('\n');
  const b = remote.split('\n');
  const inLocal = lineUp(o, a);
  const inRemote = lineUp(o, b);
  if (!inLocal || !inRemote) return appendNewLines(base, local, remote);

  const out: string[] = [];
  let io = 0, ia = 0, ib = 0;
  for (let i = 0; i <= o.length; i += 1) {
    const end = i === o.length;
    if (!end && (inLocal[i] < 0 || inRemote[i] < 0)) continue;
    // A line both sides kept, or the end: settle the stretch before it.
    const ja = end ? a.length : inLocal[i];
    const jb = end ? b.length : inRemote[i];
    out.push(...settle(o.slice(io, i), a.slice(ia, ja), b.slice(ib, jb)));
    if (!end) out.push(o[i]);
    io = i + 1; ia = ja + 1; ib = jb + 1;
  }
  return out.join('\n');
}

function same(x: string[], y: string[]) {
  return x.length === y.length && x.every((line, i) => line === y[i]);
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;

/** One stretch between lines both sides kept. */
function settle(base: string[], local: string[], remote: string[]): string[] {
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  if (same(local, remote)) return local;
  // Only new empty lines here (Enter at the end of a line): they come after the other side's.
  if (!local.some(line => line.trim())) return [...remote, ...local];
  const theirs = new Set(remote.map(line => line.trim()).filter(Boolean));
  const mine = local.filter(line => !line.trim() || !theirs.has(line.trim()));
  while (mine.length > 0 && !mine[0].trim()) mine.shift();
  if (!mine.some(line => line.trim())) return remote;
  // Lines written back to back would read as one paragraph. A list item
  // after a list item stays in the same list.
  const last = remote[remote.length - 1];
  const gap = last?.trim() && !(LIST_ITEM.test(last) && LIST_ITEM.test(mine[0])) ? [''] : [];
  return [...remote, ...gap, ...mine];
}

/**
 * For each line of `o`, the index of the line it lines up with in `x`, or
 * -1 (a longest common subsequence). The shared start and end are lined up
 * first, so an edit in one place compares only the lines around it. Null
 * when what's left is too large to compare.
 */
function lineUp(o: string[], x: string[]): number[] | null {
  const at = new Array<number>(o.length).fill(-1);
  let start = 0;
  while (start < o.length && start < x.length && o[start] === x[start]) { at[start] = start; start += 1; }
  let endO = o.length, endX = x.length;
  while (endO > start && endX > start && o[endO - 1] === x[endX - 1]) { endO -= 1; endX -= 1; at[endO] = endX; }
  const n = endO - start, k = endX - start;
  if (n === 0 || k === 0) return at;
  if (n * k > MAX_COMPARISONS) return null;
  const longest = Array.from({ length: n + 1 }, () => new Uint32Array(k + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = k - 1; j >= 0; j -= 1) {
      longest[i][j] = o[start + i] === x[start + j] ? longest[i + 1][j + 1] + 1 : Math.max(longest[i + 1][j], longest[i][j + 1]);
    }
  }
  for (let i = 0, j = 0; i < n && j < k;) {
    if (o[start + i] === x[start + j]) { at[start + i] = start + j; i += 1; j += 1; }
    else if (longest[i + 1][j] >= longest[i][j + 1]) i += 1;
    else j += 1;
  }
  return at;
}

/** The fallback for versions too far apart: the stored text, then each line this side added. */
function appendNewLines(base: string, local: string, remote: string): string {
  const lines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);
  const known = new Set([...lines(base), ...lines(remote)]);
  const added = lines(local).filter(line => !known.has(line));
  if (added.length === 0) return remote;
  const head = remote.trimEnd();
  return `${head}${head ? '\n\n' : ''}${added.join('\n\n')}`;
}
