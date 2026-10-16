/** A line diff (Myers) for comparing two material versions as text. */
export type DiffLine = { type: 'same' | 'added' | 'removed'; text: string };

export function diffLines(before: string, after: string, maxLines = 2000, maxEdits = 1500): { lines: DiffLine[]; truncated: boolean } {
  const a = before.replace(/\r\n?/g, '\n').split('\n');
  const b = after.replace(/\r\n?/g, '\n').split('\n');
  const truncated = a.length > maxLines || b.length > maxLines;
  const x = a.slice(0, maxLines), y = b.slice(0, maxLines);
  const n = x.length, m = y.length, max = n + m;
  const offset = max + 1;
  let v: Int32Array = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    if (d > maxEdits) break;
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let j = i - k;
      while (i < n && j < m && x[i] === y[j]) { i++; j++; }
      v[offset + k] = i;
      if (i >= n && j >= m) { found = true; break; }
    }
    if (found) trace.push(v.slice());
  }
  // Too many edits to align cheaply: show the whole text as replaced.
  if (!found) return { lines: [...x.map((text) => ({ type: 'removed' as const, text })), ...y.map((text) => ({ type: 'added' as const, text }))], truncated };
  // Walk the trace backwards to recover the edit script.
  const lines: DiffLine[] = [];
  let i = n, j = m;
  for (let d = trace.length - 2; d >= 0 && (i > 0 || j > 0); d--) {
    v = trace[d];
    const k = i - j;
    const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevI = v[offset + prevK];
    const prevJ = prevI - prevK;
    while (i > prevI && j > prevJ) { lines.push({ type: 'same', text: x[i - 1] }); i--; j--; }
    if (d > 0) {
      if (down) { lines.push({ type: 'added', text: y[j - 1] }); j--; }
      else { lines.push({ type: 'removed', text: x[i - 1] }); i--; }
    }
  }
  while (i > 0 && j > 0) { lines.push({ type: 'same', text: x[i - 1] }); i--; j--; }
  while (j > 0) { lines.push({ type: 'added', text: y[j - 1] }); j--; }
  while (i > 0) { lines.push({ type: 'removed', text: x[i - 1] }); i--; }
  return { lines: lines.reverse(), truncated };
}

export function diffSummary(lines: DiffLine[]): { added: number; removed: number } {
  return { added: lines.filter((line) => line.type === 'added').length, removed: lines.filter((line) => line.type === 'removed').length };
}
