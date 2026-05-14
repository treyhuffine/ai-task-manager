import {
  RangeSet,
  RangeSetBuilder,
  StateField,
  type Extension,
  type Text,
} from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';
import { presentableDiff } from '@codemirror/merge';

/**
 * Lightweight inline-diff overlay for the editable file view. Two
 * colors only — green for net-new lines, blue for any line that's been
 * modified OR sits where content was removed. We deliberately don't
 * surface deletions in their own color: the diff algorithm chunks
 * delete-then-insert as two separate changes, which made a tri-color
 * scheme fight the user's intuition. The side-by-side Diff view is the
 * right surface for "what was here before."
 *
 * Diff is computed against `base` on every doc change via
 * `presentableDiff` from `@codemirror/merge`; we translate its
 * character-range changes into per-line gutter markers.
 */

type DiffKind = 'added' | 'modified';

class DiffBar extends GutterMarker {
  constructor(readonly kind: DiffKind) {
    super();
  }
  eq(other: DiffBar) {
    return other.kind === this.kind;
  }
  toDOM() {
    const el = document.createElement('div');
    el.className = `cm-diffbar cm-diffbar-${this.kind}`;
    return el;
  }
}

function buildMarkers(base: string, current: string, doc: Text): RangeSet<DiffBar> {
  const changes = presentableDiff(base, current);
  const builder = new RangeSetBuilder<DiffBar>();
  for (const ch of changes) {
    const inserted = ch.toB > ch.fromB;
    const deleted = ch.toA > ch.fromA;
    if (inserted) {
      // Mark every line covered by the inserted range. If the change
      // also drops content (modification), use the modified color;
      // pure inserts get the added color.
      const startLine = doc.lineAt(Math.min(ch.fromB, doc.length));
      const endPos = Math.min(Math.max(ch.toB - 1, ch.fromB), doc.length);
      const endLine = doc.lineAt(endPos);
      const kind: DiffKind = deleted ? 'modified' : 'added';
      for (let n = startLine.number; n <= endLine.number; n++) {
        const line = doc.line(n);
        builder.add(line.from, line.from, new DiffBar(kind));
      }
    } else if (deleted) {
      // Content removed in B with nothing inserted in its place. The
      // line right after the deletion gets a blue bar — same vocabulary
      // as a modification, since the user reads "something changed
      // here" either way.
      const line = doc.lineAt(Math.min(ch.fromB, doc.length));
      builder.add(line.from, line.from, new DiffBar('modified'));
    }
  }
  return builder.finish();
}

const diffTheme = EditorView.baseTheme({
  '.cm-diffgutter': {
    width: '3px',
    paddingLeft: '0',
    paddingRight: '0',
  },
  '.cm-diffgutter .cm-gutterElement': {
    padding: '0',
  },
  '.cm-diffbar': {
    width: '3px',
    height: '100%',
  },
  '.cm-diffbar-added': {
    backgroundColor: 'rgb(34 197 94)', // emerald-500
  },
  '.cm-diffbar-modified': {
    backgroundColor: 'rgb(59 130 246)', // blue-500
  },
});

/**
 * Build the gutter extension keyed on a fixed `base` string. Pass a
 * fresh extension whenever the base content changes — the StateField
 * captures `base` in its closure and never re-reads it.
 */
export function inlineDiffExtension(base: string): Extension {
  const field = StateField.define<RangeSet<DiffBar>>({
    create(state) {
      return buildMarkers(base, state.doc.toString(), state.doc);
    },
    update(value, tr) {
      if (!tr.docChanged) return value;
      return buildMarkers(base, tr.state.doc.toString(), tr.state.doc);
    },
  });
  return [
    field,
    diffTheme,
    gutter({
      class: 'cm-diffgutter',
      markers: (view) => view.state.field(field),
    }),
  ];
}
