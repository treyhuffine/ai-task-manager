import { Paragraph as UpstreamParagraph } from '@tiptap/extension-paragraph'

const EMPTY_PARAGRAPH_MARKDOWN = '&nbsp;'

/**
 * Drop-in replacement for `@tiptap/extension-paragraph`'s `renderMarkdown`
 * that survives blank lines adjacent to headings.
 *
 * Upstream emits `''` for the first empty paragraph in a run and `&nbsp;` for
 * subsequent ones, relying on marked's `space` token (between two block
 * tokens) to carry the blank-line count back through parse. That works for
 * paragraph↔paragraph gaps but fails for heading↔X: marked's heading
 * tokenizer absorbs *all* trailing newlines into the heading's `raw`, so no
 * `space` token is emitted and `createImplicitEmptyParagraphsFromSpace` has
 * nothing to count — the empty paragraph silently disappears on reload.
 *
 * Fix: only emit `''` when the previous sibling is a paragraph *with content*
 * (the one case where the natural \n\n separator reliably encodes the gap).
 * Every other case — empty paragraph, heading, list, code, doc start —
 * emits `&nbsp;`, which the upstream parseMarkdown special-cases back to an
 * empty paragraph node.
 *
 * Regression coverage: src/components/editor/blank-lines.test.ts.
 */
export const Paragraph = UpstreamParagraph.extend({
  renderMarkdown(node: any, h: any, ctx: any): string {
    if (!node) return ''
    const content = Array.isArray(node.content) ? node.content : []
    if (content.length === 0) {
      const prev = ctx?.previousNode
      const prevHasText =
        prev?.type === 'paragraph' &&
        Array.isArray(prev.content) &&
        prev.content.length > 0
      return prevHasText ? '' : EMPTY_PARAGRAPH_MARKDOWN
    }
    return h.renderChildren(content)
  },
})
