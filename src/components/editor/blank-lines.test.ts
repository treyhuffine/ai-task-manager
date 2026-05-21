import { describe, expect, it } from 'vitest'
import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Typography from '@tiptap/extension-typography'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { CollapsibleHeading } from './collapsible-heading'
import { Paragraph } from './paragraph'

/**
 * Pins the round-trip behavior of blank lines through editor → markdown → editor.
 *
 * The upstream @tiptap/extension-paragraph drops empty paragraphs adjacent to
 * headings because marked's heading tokenizer absorbs trailing newlines into
 * the heading's `raw`, so no `space` token is emitted between blocks and the
 * implicit-empty-paragraph counter in @tiptap/markdown has nothing to count.
 *
 * `./paragraph.ts` patches `renderMarkdown` to emit `&nbsp;` for empty
 * paragraphs whose previous sibling isn't a non-empty paragraph — covering
 * heading→empty, doc-start→empty, empty→empty, etc.
 */
function buildManager(opts: { upstream?: boolean } = {}) {
  return new MarkdownManager({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        ...(opts.upstream ? {} : { paragraph: false as const }),
      }),
      ...(opts.upstream ? [] : [Paragraph]),
      CollapsibleHeading,
      Typography,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: false }),
      Underline,
      Link,
      Image,
      CodeBlockLowlight,
    ],
  })
}

describe('blank-line round-trip', () => {
  describe('upstream behavior (regression evidence — kept to prove the bug exists without the patch)', () => {
    it('marked tokenizer absorbs trailing newlines into headings, dropping the space token', () => {
      // This is what the upstream implicit-empty-paragraph mechanism relies on:
      // a `space` token between two block tokens whose `raw` newline count it
      // can mine. Headings break that invariant.
      const marked = buildManager().instance
      const headingPara = new marked.Lexer().lex('## yes\n\n\n\nasdfasd')
      expect(headingPara.map((t: any) => t.type)).toEqual(['heading', 'paragraph'])
      expect((headingPara[0] as any).raw).toBe('## yes\n\n\n\n')

      // Paragraph↔paragraph keeps the space token, which is why that case works:
      const paraPara = new marked.Lexer().lex('first\n\n\n\nsecond')
      expect(paraPara.map((t: any) => t.type)).toEqual(['paragraph', 'space', 'paragraph'])
    })

    it('without the patch: heading→empty→paragraph collapses to heading→paragraph', () => {
      const mgr = buildManager({ upstream: true })
      const initial = {
        type: 'doc',
        content: [
          { type: 'collapsibleHeading', attrs: { level: 2, collapsed: false }, content: [{ type: 'text', text: 'yes' }] },
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'asdfasd' }] },
        ],
      }
      const blocks = (mgr.parse(mgr.serialize(initial)).content ?? []) as any[]
      expect(blocks).toHaveLength(2) // empty paragraph dropped
    })
  })

  describe('with the patched Paragraph', () => {
    it('preserves a blank line between a heading and a paragraph', () => {
      const mgr = buildManager()
      const initial = {
        type: 'doc',
        content: [
          { type: 'collapsibleHeading', attrs: { level: 2, collapsed: false }, content: [{ type: 'text', text: 'yes' }] },
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'asdfasd' }] },
        ],
      }
      const md = mgr.serialize(initial)
      expect(md).toBe('## yes\n\n&nbsp;\n\nasdfasd')
      const blocks = (mgr.parse(md).content ?? []) as any[]
      expect(blocks).toHaveLength(3)
      expect(blocks[0].type).toBe('collapsibleHeading')
      expect(blocks[1].type).toBe('paragraph')
      expect(blocks[1].content ?? []).toHaveLength(0)
      expect(blocks[2].type).toBe('paragraph')
    })

    it('preserves a blank line between two headings', () => {
      const mgr = buildManager()
      const initial = {
        type: 'doc',
        content: [
          { type: 'collapsibleHeading', attrs: { level: 2, collapsed: false }, content: [{ type: 'text', text: 'a' }] },
          { type: 'paragraph', content: [] },
          { type: 'collapsibleHeading', attrs: { level: 2, collapsed: false }, content: [{ type: 'text', text: 'b' }] },
        ],
      }
      const blocks = (mgr.parse(mgr.serialize(initial)).content ?? []) as any[]
      expect(blocks).toHaveLength(3)
      expect(blocks[1].type).toBe('paragraph')
      expect(blocks[1].content ?? []).toHaveLength(0)
    })

    it('preserves multiple blank lines between heading and heading', () => {
      const mgr = buildManager()
      const initial = {
        type: 'doc',
        content: [
          { type: 'collapsibleHeading', attrs: { level: 2, collapsed: false }, content: [{ type: 'text', text: 'a' }] },
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [] },
          { type: 'collapsibleHeading', attrs: { level: 2, collapsed: false }, content: [{ type: 'text', text: 'b' }] },
        ],
      }
      const blocks = (mgr.parse(mgr.serialize(initial)).content ?? []) as any[]
      expect(blocks).toHaveLength(5)
      expect(blocks[1].content ?? []).toHaveLength(0)
      expect(blocks[2].content ?? []).toHaveLength(0)
      expect(blocks[3].content ?? []).toHaveLength(0)
    })

    it('still round-trips paragraph→empty(s)→paragraph (the case that already worked upstream)', () => {
      const mgr = buildManager()
      const initial = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'second' }] },
        ],
      }
      const blocks = (mgr.parse(mgr.serialize(initial)).content ?? []) as any[]
      expect(blocks).toHaveLength(5)
      expect(blocks[1].content ?? []).toHaveLength(0)
      expect(blocks[2].content ?? []).toHaveLength(0)
      expect(blocks[3].content ?? []).toHaveLength(0)
    })

    it('preserves leading blank lines', () => {
      const mgr = buildManager()
      const initial = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'after blanks' }] },
        ],
      }
      const blocks = (mgr.parse(mgr.serialize(initial)).content ?? []) as any[]
      expect(blocks).toHaveLength(3)
      expect(blocks[0].content ?? []).toHaveLength(0)
      expect(blocks[1].content ?? []).toHaveLength(0)
    })

    it('preserves trailing blank lines', () => {
      const mgr = buildManager()
      const initial = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'before blanks' }] },
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [] },
        ],
      }
      const blocks = (mgr.parse(mgr.serialize(initial)).content ?? []) as any[]
      expect(blocks).toHaveLength(4)
      expect(blocks[1].content ?? []).toHaveLength(0)
      expect(blocks[2].content ?? []).toHaveLength(0)
      expect(blocks[3].content ?? []).toHaveLength(0)
    })

    it('round-trips a heading-rich document with mixed blank-line patterns', () => {
      const mgr = buildManager()
      const initial = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'intro' }] },
          { type: 'collapsibleHeading', attrs: { level: 2, collapsed: false }, content: [{ type: 'text', text: 'section' }] },
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [] },
          { type: 'collapsibleHeading', attrs: { level: 3, collapsed: false }, content: [{ type: 'text', text: 'sub' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'final' }] },
        ],
      }
      // Two round-trips should be a fixed point.
      const once = mgr.serialize(mgr.parse(mgr.serialize(initial)))
      const twice = mgr.serialize(mgr.parse(once))
      expect(twice).toBe(once)
      const blocks = (mgr.parse(once).content ?? []) as any[]
      expect(blocks).toHaveLength(initial.content.length)
    })
  })
})
