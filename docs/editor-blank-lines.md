# Blank-Line Preservation in Task & Note Bodies

## The problem

When a user presses Enter multiple times to add visual spacing between sections
in a task or note body, those blank lines disappear after the note reloads —
but only when the gap is next to a heading. Paragraph-to-paragraph gaps survive.

## Root cause

Body content is stored as markdown, and CommonMark explicitly defines multiple
consecutive blank lines as equivalent to a single blank line. Editors that
round-trip through markdown therefore have to encode empty paragraphs
explicitly.

The official `@tiptap/markdown` extension (3.20.2+) does this with two
mechanisms working together:

1. **Implicit empty paragraphs from `space` tokens.** When marked emits a
   `space` token between two block tokens, `createImplicitEmptyParagraphsFromSpace`
   counts `\n\n` pairs in its `raw` and synthesizes that many empty paragraphs.
2. **`&nbsp;` markers** for subsequent empty paragraphs in a run, parsed back
   via a special case in the Paragraph extension's `parseMarkdown`.

Both rely on marked emitting a `space` token. **It doesn't, after a heading.**
Marked's heading tokenizer absorbs all trailing newlines into the heading's
`raw`:

```
"## yes\n\n\n\nasdfasd"
  → [{ type: 'heading', raw: '## yes\n\n\n\n' },
     { type: 'paragraph', raw: 'asdfasd' }]
```

No `space` token, no implicit empty paragraphs, and the upstream renderer emits
`''` (not `&nbsp;`) for the first empty paragraph after a heading — so the
empty paragraph is invisible on the way out *and* on the way back in.

Paragraph→paragraph keeps the space token, which is why that case works:

```
"first\n\n\n\nsecond"
  → [paragraph, { type: 'space', raw: '\n\n\n\n' }, paragraph]
```

## The fix

`src/components/editor/paragraph.ts` exports a patched `Paragraph` extension
that overrides `renderMarkdown`. Empty paragraphs emit `''` only when the
previous sibling is a paragraph *with content* (the one case where the
natural `\n\n` separator can reliably encode the gap). Every other case —
empty paragraph, heading, list, code, doc start — emits `&nbsp;`.

The upstream `parseMarkdown` already turns `&nbsp;` paragraphs back into empty
paragraph nodes, so no parse-side change is needed.

`rich-editor.tsx` wires it in via `StarterKit.configure({ paragraph: false })`
and adds the patched Paragraph immediately after.

## Trade-off

Mirror `.md` files will show explicit `&nbsp;` markers in more places (any
blank line adjacent to a heading). Acceptable: the alternative is silent data
loss, and the mirror is a derived view, not the user's editing surface.

## Regression test

`src/components/editor/blank-lines.test.ts` exercises the markdown round-trip
through `MarkdownManager` directly (no DOM, no React). It covers:

- The upstream behavior (kept to prove the bug exists without the patch).
- The patched cases: heading→empty→paragraph, heading→empty(s)→heading,
  leading blanks, trailing blanks, mixed-pattern docs, and the unchanged
  paragraph↔paragraph case.

Run with `pnpm vitest run src/components/editor/blank-lines.test.ts`.

## The CodeMirror alternative

For completeness — going Obsidian-style would solve this by design (raw .md
is the source of truth, no round-trip). It would also be a significant
rewrite. We currently rely on Tiptap-specific functionality that has no
out-of-the-box CodeMirror equivalent:

- Slash command menu
- Drag handle gutter
- `CollapsibleHeading` custom node-view
- Bubble menu
- Task list with native checkbox nodes
- Inline image embeds with thumbnails
- AutoJoiner
- File attachment chip nodes

The mature CodeMirror 6 "rich markdown" libraries
(`codemirror-rich-markdoc`, `simple-markdown-editor`) are early-stage and
don't bundle these features. Obsidian's editor is years of custom engineering
on top of CM6. Estimated effort for parity: weeks, not days.

## References

- [Tiptap @tiptap/markdown changelog](https://tiptap.dev/docs/resources/changelog/markdown)
- [Tiptap Markdown extension integration guide](https://tiptap.dev/docs/editor/markdown/guides/integrate-markdown-in-your-extension)
- [Notion/Linear empty-line discussion (ProseMirror forum)](https://discuss.prosemirror.net/t/how-do-apps-like-notion-and-linear-preserve-empty-lines-using-prosemirror/8386)
- [CommonMark spec](https://spec.commonmark.org/0.17/)
