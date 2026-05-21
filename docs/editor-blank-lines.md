# Blank-Line Preservation in Task & Note Bodies

## The problem

When a user presses Enter multiple times to add visual spacing between sections
in a task or note body, those blank lines disappear after the note reloads.
Multiple consecutive empty paragraphs collapse to a single paragraph break.

## Why this happens

Body content is stored as markdown, and **CommonMark explicitly defines multiple
consecutive blank lines as equivalent to a single blank line**. From the spec:
paragraphs are separated by "one or more blank lines" — one and many are
indistinguishable. This is not a Tiptap bug or a serializer quirk; it is the
markdown spec.

Any WYSIWYG editor that persists as markdown has to either:

1. Accept the loss (most do, including older Tiptap).
2. Encode empty paragraphs with an explicit marker that survives the
   markdown ↔ doc-model round-trip.
3. Stop round-tripping entirely (Obsidian's approach).

## How other editors handle it

**Obsidian** sidesteps the problem by *not* having a document model in the
middle. Its editor is CodeMirror editing the raw `.md` file directly. Blank
lines you type are blank lines in the file, byte-for-byte. Reading mode renders
CommonMark and visually collapses them, but switching back to Source shows
your spacing intact because the file was never touched.

**Notion, Linear, and Tiptap-based apps** that round-trip through ProseMirror
encode empty paragraphs in their serialized form. The Tiptap and ProseMirror
community has converged on a non-breaking-space marker.

## What Tiptap already does

As of **`@tiptap/markdown` 3.20.2**, the official extension preserves empty
paragraphs across round-trips:

> Empty paragraphs now serialize with natural blank-line spacing for the first
> paragraph in a run and `&nbsp;` markers for subsequent empty paragraphs at
> the same level, while parsing preserves those empty paragraphs when
> converting markdown back to JSON.

Mechanically:

- 1 blank line typed → 1 blank line in markdown (normal paragraph separator).
- 2 blank lines → 1 blank line + 1 paragraph containing `&nbsp;`.
- N blank lines → 1 blank line + (N-1) paragraphs containing `&nbsp;`.

Parsing reverses it. The `&nbsp;` is not a hack we'd be inventing — it is the
official mechanism that ships with the extension.

The extension also added `helpers.parseBlockChildren` for custom extensions
whose nodes contain other block content and need empty-paragraph runs to
survive the round-trip. (Inline-only nodes like our `CollapsibleHeading` don't
need this — they contain `inline*` only.)

## Where we stand

- We use `@tiptap/markdown` `^3.21.0` (resolved to `3.21.0` in the lockfile),
  which is **after** 3.20.2 — the preservation logic is present.
- `src/lib/db/queries.ts` does not normalize body whitespace; body flows
  unchanged from editor → DB → editor.
- The `.trim()` calls in `src/lib/export/mirror/render.ts` and
  `src/lib/export/markdown.ts` touch the markdown-mirror export only, not the
  editor's read path, so they don't explain what the user sees.

Yet the user is still losing blank lines. That means **something in our
pipeline is interfering with the `&nbsp;` round-trip**, but we haven't
identified what without a live reproduction. Likely candidates:

- The `editor.markdown.parse()` call at `src/components/editor/rich-editor.tsx:242`
  may not be configured to emit the `&nbsp;` paragraphs on parse.
- The mirror export (`.trim()` + line joining) may be writing back to the DB
  somewhere, stripping the markers.
- An AI tool that updates body via the orchestrator may be re-serializing
  with a different (older or stricter) serializer.

## Path forward

1. **Reproduce in dev.** Start the server, type two paragraphs with several
   blank lines between them, save, reload, inspect the stored markdown
   directly (`pnpm db:studio` or sqlite shell). Confirm whether the DB row
   contains `&nbsp;` markers or not.
2. **If the DB doesn't have `&nbsp;`:** Tiptap isn't emitting them. Inspect
   `editor.getMarkdown()` output in the browser and check the Markdown
   extension configuration in `rich-editor.tsx:112`.
3. **If the DB has `&nbsp;` but the editor still collapses on reload:**
   something downstream of `markdown.parse` is dropping the empty paragraphs.
4. Only after that diagnosis does it make sense to consider patches.

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

**Recommendation:** fix the round-trip inside the current Tiptap setup. The
machinery already exists; we just need to find what's defeating it.

## References

- [Tiptap @tiptap/markdown changelog](https://tiptap.dev/docs/resources/changelog/markdown)
- [Tiptap Markdown extension integration guide](https://tiptap.dev/docs/editor/markdown/guides/integrate-markdown-in-your-extension)
- [Notion/Linear empty-line discussion (ProseMirror forum)](https://discuss.prosemirror.net/t/how-do-apps-like-notion-and-linear-preserve-empty-lines-using-prosemirror/8386)
- [CommonMark spec](https://spec.commonmark.org/0.17/)
- [codemirror-rich-markdoc](https://github.com/segphault/codemirror-rich-markdoc)
- [simple-markdown-editor (Obsidian-style WYSIWYG on CM6)](https://github.com/CTRL-Neo-Studios/simple-markdown-editor)
