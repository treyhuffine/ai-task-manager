import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * What the scratchpad's Task, Note, Stream and Chat actions move
 * (docs/scratchpad.md, "Moving a line out"): the selection, or with nothing
 * selected the line the caret is on, so one line never needs selecting.
 */
export interface PadTarget {
  kind: 'selection' | 'line';
  /** The text moved: a task's or note's chip takes its place. */
  from: number;
  to: number;
  text: string;
  /** What handing it to the Stream clears: the selection, or the line's
   *  whole block, with the list item or list it would leave empty. */
  removeFrom: number;
  removeTo: number;
}

/** A chip already in the pad moves as its marker, so the new task or note links to it. */
function leafText(node: PMNode): string {
  return node.type.name === 'entityLink' ? `[[${node.attrs.kind}:${node.attrs.id}]]` : '';
}

export function textOf(state: EditorState, from: number, to: number): string {
  return state.doc.textBetween(from, to, '\n', leafText).trim();
}

export function padTarget(state: EditorState): PadTarget | null {
  const { from, to, empty, $from } = state.selection;
  if (!empty) {
    const text = textOf(state, from, to);
    return text ? { kind: 'selection', from, to, text, removeFrom: from, removeTo: to } : null;
  }
  if (!$from.parent.isTextblock) return null;
  const start = $from.start();
  const end = $from.end();
  const text = textOf(state, start, end);
  if (!text) return null;
  let depth = $from.depth;
  while (depth > 1 && $from.node(depth - 1).childCount === 1) depth -= 1;
  return { kind: 'line', from: start, to: end, text, removeFrom: $from.before(depth), removeTo: $from.after(depth) };
}

/** A task or note takes a moment to create. The text may have moved meanwhile. */
export function targetStillThere(state: EditorState, target: PadTarget): boolean {
  return target.to <= state.doc.content.size && textOf(state, target.from, target.to) === target.text;
}

/** A task's title is its first line, and the rest of what moved becomes its body. */
export function titleAndBody(text: string): { title: string; body: string } {
  const [first = '', ...rest] = text.split('\n');
  const title = first.trim().slice(0, 200) || text.trim().slice(0, 200);
  const body = rest.join('\n').trim();
  return { title, body };
}

/**
 * Show text that changed somewhere else (another device, a merge) by
 * replacing only the part that differs, so the caret, the selection and the
 * scroll position move with the edit instead of being reset. Null when
 * nothing differs.
 */
export function replaceChanged(state: EditorState, next: PMNode): Transaction | null {
  const start = state.doc.content.findDiffStart(next.content);
  if (start == null) return null;
  const end = state.doc.content.findDiffEnd(next.content);
  if (!end) return null;
  let { a: endA, b: endB } = end;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) { endA += overlap; endB += overlap; }
  return state.tr.replace(start, endA, next.slice(start, endB));
}
