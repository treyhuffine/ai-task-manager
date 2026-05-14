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
import { useState, useCallback, useEffect, useMemo } from 'react'
import type { Editor } from '@tiptap/core'

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

// Identity for a folded heading: `${ordinal}:${text}`. Ordinal disambiguates
// duplicate heading text so folding "## Setup" #1 doesn't also fold "## Setup" #0.
// Text-based (not line-based) means inserts/reorders preserve folds; renames lose them.
function encodeHeadingId(text: string, ordinal: number): string {
  return `${ordinal}:${text.trim()}`
}

export function getFoldedHeadingIds(editor: Editor): string[] {
  const ids: string[] = []
  const counts = new Map<string, number>()
  editor.state.doc.forEach((node) => {
    if (node.type.name !== 'collapsibleHeading') return
    const text = node.textContent.trim()
    const ordinal = counts.get(text) ?? 0
    counts.set(text, ordinal + 1)
    if (node.attrs.collapsed) ids.push(encodeHeadingId(text, ordinal))
  })
  return ids
}

export function applyFoldedHeadingIds(editor: Editor, ids: readonly string[]): void {
  if (ids.length === 0) return
  const set = new Set(ids)
  const counts = new Map<string, number>()
  const tr = editor.state.tr
  let mutated = false
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name !== 'collapsibleHeading') return
    const text = node.textContent.trim()
    const ordinal = counts.get(text) ?? 0
    counts.set(text, ordinal + 1)
    if (set.has(encodeHeadingId(text, ordinal)) && !node.attrs.collapsed) {
      tr.setNodeAttribute(offset, 'collapsed', true)
      mutated = true
    }
  })
  if (mutated) {
    tr.setMeta('addToHistory', false)
    editor.view.dispatch(tr)
  }
}

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

// Counts logical text lines inside a node. Each leaf block counts as 1 line
// (paragraph, list item, heading), with extra newlines inside (e.g. code blocks)
// adding to the count. Empty leaf blocks still count as 1 line.
function countLinesInNode(node: any): number {
  let lines = 0
  let isLeafBlock = true
  node.forEach((child: any) => {
    if (child.isBlock) {
      isLeafBlock = false
      lines += countLinesInNode(child)
    }
  })
  if (isLeafBlock) {
    const text = node.textContent ?? ''
    return text.length === 0 ? 1 : text.split('\n').length
  }
  return lines
}

// Counts hidden text lines under this heading: walks every node after it
// up to (but not including) the next heading at this level or shallower.
function countHiddenLines(editor: Editor, selfPos: number, selfLevel: number): number {
  const doc = editor.state.doc
  let pos = 0
  let started = false
  let total = 0
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    if (started) {
      if (
        child.type.name === 'collapsibleHeading' &&
        (child.attrs.level as number) <= selfLevel
      ) {
        break
      }
      total += countLinesInNode(child)
    }
    if (pos === selfPos) started = true
    pos += child.nodeSize
  }
  return total
}

// The React component rendered for each heading
function CollapsibleHeadingView(props: ReactNodeViewProps) {
  const { node, updateAttributes, editor, getPos } = props
  const level = (node.attrs.level ?? 1) as Level
  const collapsed = !!node.attrs.collapsed
  const [isHovered, setIsHovered] = useState(false)
  // Bumps on every editor doc update so the hidden-block count refreshes when
  // siblings change. Only subscribed while collapsed — non-collapsed headings
  // don't show the indicator and don't need to rerender on every keystroke.
  const [updateTick, setUpdateTick] = useState(0)

  useEffect(() => {
    if (!collapsed || !editor) return
    const handler = () => setUpdateTick((t) => t + 1)
    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
    }
  }, [collapsed, editor])

  const hiddenCount = useMemo(() => {
    if (!collapsed || !editor) return 0
    const pos = typeof getPos === 'function' ? getPos() : null
    if (pos == null) return 0
    return countHiddenLines(editor, pos, level)
    // updateTick is intentional — drives recompute on sibling edits
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, editor, getPos, level, updateTick])

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
      className={`collapsible-heading-wrapper${showToggle ? ' show-toggle' : ''}${collapsed ? ' is-collapsed' : ''}`}
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
      {collapsed && hiddenCount > 0 && (
        <button
          type="button"
          className="collapsed-indicator text-sky-400/80 hover:text-sky-300"
          onClick={toggleCollapse}
          contentEditable={false}
          aria-label={`Expand section (${hiddenCount} ${hiddenCount === 1 ? 'line' : 'lines'} hidden)`}
          title="Click to expand"
        >
          <span aria-hidden="true">···</span> {hiddenCount} {hiddenCount === 1 ? 'line' : 'lines'}
        </button>
      )}
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
