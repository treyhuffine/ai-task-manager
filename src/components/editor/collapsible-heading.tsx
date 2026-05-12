'use client'

import { Node, mergeAttributes, textblockTypeInputRule } from '@tiptap/core'
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
  type ReactNodeViewProps,
} from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ChevronRight } from 'lucide-react'
import { useState, useCallback } from 'react'

type Level = 1 | 2 | 3 | 4 | 5 | 6

const TAG_MAP: Record<Level, string> = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
}

const collapsibleKey = new PluginKey('collapsibleHeading')

/**
 * Build decorations that hide nodes under collapsed headings.
 * Uses ProseMirror's decoration system instead of direct DOM manipulation
 * to avoid triggering the mutation observer → infinite update loop.
 */
function buildCollapsedDecorations(doc: any): DecorationSet {
  const decorations: Decoration[] = []
  let activeCollapse: { level: number } | null = null

  doc.forEach((node: any, offset: number) => {
    if (node.type.name === 'collapsibleHeading') {
      const level = node.attrs.level as number
      // If we hit a heading at the same or higher level, end the collapse
      if (activeCollapse && level <= activeCollapse.level) {
        activeCollapse = null
      }
      // If this heading is collapsed, start hiding everything after it
      if (node.attrs.collapsed) {
        activeCollapse = { level }
        return // The heading itself stays visible
      }
    } else if (activeCollapse) {
      decorations.push(
        Decoration.node(offset, offset + node.nodeSize, {
          class: 'collapsed-hidden',
        })
      )
    }
  })

  return DecorationSet.create(doc, decorations)
}

// The React component rendered for each heading
function CollapsibleHeadingView(props: ReactNodeViewProps) {
  const { node, updateAttributes } = props
  const level = (node.attrs.level ?? 1) as Level
  const collapsed = !!node.attrs.collapsed
  const [isHovered, setIsHovered] = useState(false)

  const toggleCollapse = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      updateAttributes({ collapsed: !collapsed })
      // The ProseMirror plugin handles DOM visibility after the transaction
    },
    [collapsed, updateAttributes]
  )

  const showToggle = isHovered || collapsed

  return (
    <NodeViewWrapper
      className={`collapsible-heading-wrapper${showToggle ? ' show-toggle' : ''}`}
      data-level={level}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        type="button"
        className="collapsible-toggle text-muted-foreground/60 hover:text-foreground hover:bg-accent"
        onClick={toggleCollapse}
        contentEditable={false}
        aria-label={collapsed ? 'Expand section' : 'Collapse section'}
      >
        <ChevronRight
          className={`transition-transform duration-200 ${
            collapsed ? '' : 'rotate-90'
          }`}
          size={level === 1 ? 16 : level === 2 ? 15 : 14}
        />
      </button>
      <NodeViewContent
        as={TAG_MAP[level] as any}
        className="collapsible-heading-content"
      />
    </NodeViewWrapper>
  )
}

// The custom Tiptap extension
export const CollapsibleHeading = Node.create({
  name: 'collapsibleHeading',
  group: 'block',
  content: 'inline*',
  defining: true,

  // Map to standard markdown heading tokens for round-trip serialization
  markdownTokenName: 'heading',

  parseMarkdown: (token: any, helpers: any) => {
    const level = token.depth || 1
    const content = helpers.parseInline(token.tokens || [])
    return {
      type: 'collapsibleHeading',
      attrs: { level, collapsed: false },
      content,
    }
  },

  renderMarkdown: (node: any, helpers: any) => {
    const level = node.attrs?.level ? parseInt(node.attrs.level as string, 10) : 1
    const prefix = '#'.repeat(level)

    if (!node.content) {
      return ''
    }

    return `${prefix} ${helpers.renderChildren(node.content)}`
  },

  addAttributes() {
    return {
      level: {
        default: 1,
        rendered: false,
      },
      collapsed: {
        default: false,
        rendered: false,
      },
    }
  },

  parseHTML() {
    return [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      attrs: { level },
    }))
  },

  renderHTML({
    node,
    HTMLAttributes,
  }: {
    node: any
    HTMLAttributes: Record<string, any>
  }) {
    const tag = `h${node.attrs.level}`
    return [tag, mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CollapsibleHeadingView)
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: collapsibleKey,
        state: {
          init(_, { doc }) {
            return buildCollapsedDecorations(doc)
          },
          apply(tr, oldSet) {
            // Only rebuild decorations when the doc changes
            if (tr.docChanged) {
              return buildCollapsedDecorations(tr.doc)
            }
            return oldSet
          },
        },
        props: {
          decorations(state) {
            return collapsibleKey.getState(state)
          },
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    return [1, 2, 3, 4, 5, 6].reduce(
      (shortcuts, level) => ({
        ...shortcuts,
        [`Mod-Alt-${level}`]: () =>
          this.editor.commands.toggleNode(this.name, 'paragraph', {
            level,
          }),
      }),
      {} as Record<string, () => boolean>
    )
  },

  addInputRules() {
    return [1, 2, 3, 4, 5, 6].map((level) =>
      textblockTypeInputRule({
        find: new RegExp(`^(#{${level}})\\s$`),
        type: this.type,
        getAttributes: () => ({ level }),
      })
    )
  },
})
