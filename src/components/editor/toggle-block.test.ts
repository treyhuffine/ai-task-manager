import { describe, expect, it } from 'vitest'
import { MarkdownManager } from '@tiptap/markdown'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { Schema } from '@tiptap/pm/model'
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
import {
  Toggle,
  ToggleSummary,
  ToggleContent,
  buildSetToggleTr,
  buildUnsetToggleTr,
} from './toggle-block'

/**
 * Pins the markdown round-trip for the standalone toggle block. A toggle is
 * structural, so unlike a heading fold its shape MUST survive editor → markdown
 * → editor or the body would decompose into loose paragraphs on the next sync.
 *
 * The encoding is `<details>` HTML with the open/closed state in the native
 * `open` attribute. See toggle-markdown.ts.
 */
const EDITOR_EXTENSIONS = [
  StarterKit.configure({
    heading: false,
    codeBlock: false,
    paragraph: false as const,
  }),
  Paragraph,
  CollapsibleHeading,
  Toggle,
  ToggleSummary,
  ToggleContent,
  Typography,
  TaskList,
  TaskItem.configure({ nested: true }),
  Highlight.configure({ multicolor: false }),
  Underline,
  Link,
  Image,
  CodeBlockLowlight,
]

function buildManager() {
  return new MarkdownManager({ extensions: EDITOR_EXTENSIONS })
}

function toggleDoc(attrs: { open: boolean }, summary: string, body: any[]) {
  return {
    type: 'doc',
    content: [
      {
        type: 'toggle',
        attrs,
        content: [
          { type: 'toggleSummary', content: [{ type: 'text', text: summary }] },
          { type: 'toggleContent', content: body },
        ],
      },
    ],
  }
}

const para = (text?: string) => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : [],
})

describe('toggle block markdown round-trip', () => {
  it('serializes an open toggle to <details open>', () => {
    const mgr = buildManager()
    const md = mgr.serialize(toggleDoc({ open: true }, 'Summary', [para('Body text')]))
    expect(md).toBe('<details open>\n<summary>Summary</summary>\n\nBody text\n\n</details>')
  })

  it('serializes a closed toggle to bare <details>', () => {
    const mgr = buildManager()
    const md = mgr.serialize(toggleDoc({ open: false }, 'Summary', [para('Body text')]))
    expect(md).toBe('<details>\n<summary>Summary</summary>\n\nBody text\n\n</details>')
  })

  it('round-trips the open bit both ways', () => {
    const mgr = buildManager()
    for (const open of [true, false]) {
      const md = mgr.serialize(toggleDoc({ open }, 'S', [para('B')]))
      const blocks = (mgr.parse(md).content ?? []) as any[]
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('toggle')
      expect(blocks[0].attrs.open).toBe(open)
    }
  })

  it('preserves the summary/content structure through a round-trip', () => {
    const mgr = buildManager()
    const md = mgr.serialize(toggleDoc({ open: true }, 'Click me', [para('Hidden one'), para('Hidden two')]))
    const blocks = (mgr.parse(md).content ?? []) as any[]
    const toggle = blocks[0]
    expect(toggle.type).toBe('toggle')
    expect(toggle.content[0].type).toBe('toggleSummary')
    expect(toggle.content[0].content[0].text).toBe('Click me')
    expect(toggle.content[1].type).toBe('toggleContent')
    expect(toggle.content[1].content).toHaveLength(2)
    expect(toggle.content[1].content[0].content[0].text).toBe('Hidden one')
    expect(toggle.content[1].content[1].content[0].text).toBe('Hidden two')
  })

  it('preserves markdown formatting inside the body (heading, list, bold)', () => {
    const mgr = buildManager()
    const doc = toggleDoc({ open: true }, 'Section', [
      { type: 'collapsibleHeading', attrs: { level: 2, collapsed: false }, content: [{ type: 'text', text: 'Inner heading' }] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }] },
    ])
    const once = mgr.serialize(doc)
    // The inner heading must be a real `##`, not raw text — proof the body was
    // recursively lexed rather than captured as an opaque HTML block.
    expect(once).toContain('## Inner heading')
    expect(once).toContain('- one')
    expect(once).toContain('**bold**')

    const blocks = (mgr.parse(once).content ?? []) as any[]
    const body = blocks[0].content[1].content
    expect(body[0].type).toBe('collapsibleHeading')
    expect(body[1].type).toBe('bulletList')
    expect(body[2].content[0].marks?.[0].type).toBe('bold')
  })

  it('round-trips bold/link marks in the summary', () => {
    const mgr = buildManager()
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'toggle',
          attrs: { open: true },
          content: [
            {
              type: 'toggleSummary',
              content: [
                { type: 'text', text: 'strong', marks: [{ type: 'bold' }] },
                { type: 'text', text: ' plain' },
              ],
            },
            { type: 'toggleContent', content: [para('body')] },
          ],
        },
      ],
    }
    const md = mgr.serialize(doc)
    expect(md).toContain('<summary>**strong** plain</summary>')
    const summary = ((mgr.parse(md).content ?? []) as any[])[0].content[0]
    expect(summary.content[0].marks?.[0].type).toBe('bold')
    expect(summary.content[0].text).toBe('strong')
  })

  it('round-trips nested toggles', () => {
    const mgr = buildManager()
    const inner = {
      type: 'toggle',
      attrs: { open: false },
      content: [
        { type: 'toggleSummary', content: [{ type: 'text', text: 'Inner' }] },
        { type: 'toggleContent', content: [para('deep')] },
      ],
    }
    const doc = toggleDoc({ open: true }, 'Outer', [inner, para('after inner')])
    const once = mgr.serialize(doc)
    const twice = mgr.serialize(mgr.parse(once))
    expect(twice).toBe(once)

    const outer = ((mgr.parse(once).content ?? []) as any[])[0]
    const nested = outer.content[1].content[0]
    expect(nested.type).toBe('toggle')
    expect(nested.attrs.open).toBe(false)
    expect(nested.content[0].content[0].text).toBe('Inner')
    expect(nested.content[1].content[0].content[0].text).toBe('deep')
  })

  it('round-trips an empty toggle body', () => {
    const mgr = buildManager()
    const doc = toggleDoc({ open: true }, 'Empty', [para()])
    const md = mgr.serialize(doc)
    const blocks = (mgr.parse(md).content ?? []) as any[]
    expect(blocks[0].type).toBe('toggle')
    const body = blocks[0].content[1]
    expect(body.type).toBe('toggleContent')
    expect(body.content).toHaveLength(1)
    expect(body.content[0].type).toBe('paragraph')
    expect(body.content[0].content ?? []).toHaveLength(0)
  })

  it('is a serialization fixed point over two round-trips', () => {
    const mgr = buildManager()
    const doc = {
      type: 'doc',
      content: [
        para('intro'),
        toggleDoc({ open: true }, 'Toggle A', [para('a body')]).content[0],
        para('between'),
        toggleDoc({ open: false }, 'Toggle B', [para('b body')]).content[0],
        para('outro'),
      ],
    }
    const once = mgr.serialize(mgr.parse(mgr.serialize(doc)))
    const twice = mgr.serialize(mgr.parse(once))
    expect(twice).toBe(once)
    const blocks = (mgr.parse(once).content ?? []) as any[]
    expect(blocks.map((b) => b.type)).toEqual([
      'paragraph',
      'toggle',
      'paragraph',
      'toggle',
      'paragraph',
    ])
  })

  it('does not disturb a plain document without toggles', () => {
    const mgr = buildManager()
    const doc = {
      type: 'doc',
      content: [
        { type: 'collapsibleHeading', attrs: { level: 1, collapsed: false }, content: [{ type: 'text', text: 'Title' }] },
        para('A paragraph.'),
      ],
    }
    const md = mgr.serialize(doc)
    expect(md).toBe('# Title\n\nA paragraph.')
  })
})

describe('toggle block schema', () => {
  it('builds a valid ProseMirror schema (content expressions resolve)', () => {
    const schema = getSchema(EDITOR_EXTENSIONS)
    expect(schema.nodes.toggle).toBeDefined()
    expect(schema.nodes.toggleSummary).toBeDefined()
    expect(schema.nodes.toggleContent).toBeDefined()
    expect(schema.nodes.toggle.spec.content).toBe('toggleSummary toggleContent')
    expect(schema.nodes.toggleContent.spec.content).toBe('block+')
    expect(schema.nodes.toggle.spec.isolating).toBe(true)
  })

  it('parsed toggles are structurally valid PM nodes (node.check passes)', () => {
    const schema = getSchema(EDITOR_EXTENSIONS)
    const mgr = buildManager()
    const cases = [
      toggleDoc({ open: true }, 'S', [para('body')]),
      toggleDoc({ open: false }, 'S', [para()]), // empty body
      toggleDoc({ open: true }, 'Outer', [
        {
          type: 'toggle',
          attrs: { open: false },
          content: [
            { type: 'toggleSummary', content: [{ type: 'text', text: 'Inner' }] },
            { type: 'toggleContent', content: [para('deep')] },
          ],
        },
      ]),
    ]
    for (const input of cases) {
      const parsed = mgr.parse(mgr.serialize(input))
      // Throws if the parsed JSON violates the schema (e.g. empty block+ body).
      const node = schema.nodeFromJSON(parsed)
      expect(() => node.check()).not.toThrow()
    }
  })
})

function stateFrom(schema: Schema, doc: any, cursor: number) {
  const pmDoc = schema.nodeFromJSON(doc)
  return EditorState.create({
    schema,
    doc: pmDoc,
    selection: TextSelection.create(pmDoc, cursor),
  })
}

describe('toggle block commands (headless transaction builders)', () => {
  const schema = getSchema(EDITOR_EXTENSIONS)

  it('setToggle wraps the current paragraph, summary = its text, cursor in summary', () => {
    const state = stateFrom(schema, { type: 'doc', content: [para('hello')] }, 3)
    const tr = buildSetToggleTr(state)
    expect(tr).not.toBeNull()
    const next = state.apply(tr!)

    const toggle = next.doc.firstChild!
    expect(toggle.type.name).toBe('toggle')
    expect(toggle.attrs.open).toBe(true)
    expect(toggle.child(0).type.name).toBe('toggleSummary')
    expect(toggle.child(0).textContent).toBe('hello')
    expect(toggle.child(1).type.name).toBe('toggleContent')
    expect(toggle.child(1).childCount).toBe(1)
    expect(toggle.child(1).firstChild!.type.name).toBe('paragraph')
    // Cursor sits at the end of the summary text.
    expect(next.selection.$from.parent.type.name).toBe('toggleSummary')
    expect(next.selection.$from.parentOffset).toBe('hello'.length)
    expect(() => next.doc.check()).not.toThrow()
  })

  it('setToggle returns null when the block is not a wrappable textblock', () => {
    // Cursor inside a list item's paragraph — the depth-1 block is the list.
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [para('item')] },
          ],
        },
      ],
    }
    const state = stateFrom(schema, doc, 4)
    expect(buildSetToggleTr(state)).toBeNull()
  })

  it('unsetToggle unwraps back into a paragraph + body blocks', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'toggle',
          attrs: { open: true },
          content: [
            { type: 'toggleSummary', content: [{ type: 'text', text: 'hi' }] },
            { type: 'toggleContent', content: [para('body one'), para('body two')] },
          ],
        },
      ],
    }
    // Cursor inside the summary ("hi").
    const state = stateFrom(schema, doc, 3)
    const tr = buildUnsetToggleTr(state)
    expect(tr).not.toBeNull()
    const next = state.apply(tr!)

    expect(next.doc.childCount).toBe(3)
    expect(next.doc.child(0).type.name).toBe('paragraph')
    expect(next.doc.child(0).textContent).toBe('hi')
    expect(next.doc.child(1).textContent).toBe('body one')
    expect(next.doc.child(2).textContent).toBe('body two')
    expect(() => next.doc.check()).not.toThrow()
  })

  it('setToggle then unsetToggle is a round trip back to a paragraph', () => {
    const state = stateFrom(schema, { type: 'doc', content: [para('roundtrip')] }, 3)
    const wrapped = state.apply(buildSetToggleTr(state)!)
    const unwrapped = wrapped.apply(buildUnsetToggleTr(wrapped)!)
    expect(unwrapped.doc.firstChild!.type.name).toBe('paragraph')
    expect(unwrapped.doc.firstChild!.textContent).toBe('roundtrip')
  })
})
