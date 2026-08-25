'use client'

import { Node, mergeAttributes, InputRule } from '@tiptap/core'
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
  type ReactNodeViewProps,
} from '@tiptap/react'
import { TextSelection, Selection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { ChevronRight } from 'lucide-react'
import { useCallback } from 'react'
import {
  TOGGLE_TOKEN,
  toggleMarkdownTokenizer,
  parseToggleMarkdown,
  renderToggleMarkdown,
} from './toggle-markdown'

/**
 * Standalone collapsible ("toggle") block — a Notion-style disclosure that is
 * NOT a heading. Three nodes:
 *
 *   toggle          — container, carries the `open` attribute
 *    ├─ toggleSummary  — the always-visible clickable line (inline)
 *    └─ toggleContent  — the hideable body (block+)
 *
 * The body hides via CSS when `open` is false (see .toggle-block[data-open]
 * rules in globals.css), so there is no doc-walking decoration plugin like the
 * heading fold uses — the body is genuinely inside the node.
 *
 * Open/closed state lives in the doc as the `open` attribute and serializes into
 * the `<details open>` markdown (see toggle-markdown.ts), so it survives reloads
 * and round-trips with no out-of-band tracking. Toggling is applied with
 * `addToHistory: false` so collapsing a section is not an undoable edit.
 *
 * Created via `/toggle`, the "turn into toggle" bubble-menu action, or the `<`
 * input rule (the mirror of Notion's `>`, which we reserve for blockquote).
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggleBlock: {
      /** Wrap the current top-level block into a toggle (its text becomes the summary). */
      setToggle: () => ReturnType
      /** Unwrap the enclosing toggle back into a paragraph followed by its body blocks. */
      unsetToggle: () => ReturnType
    }
  }
}

/** Depth of the nearest ancestor of `$from` with the given node-type name, or -1. */
function ancestorDepth($from: ResolvedPos, typeName: string): number {
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type.name === typeName) return d
  }
  return -1
}

/**
 * Build the transaction that wraps the current top-level textblock into a
 * toggle (its inline content becomes the summary; an empty paragraph seeds the
 * body). Returns null when the selection is not in a wrappable block. Pure over
 * `state` so it is unit-testable against a schema without a DOM — the commands
 * below are thin wrappers. In a command chain `state.tr` is the shared
 * transaction, so mutating it composes with the chain.
 */
export function buildSetToggleTr(state: EditorState): Transaction | null {
  const { schema, selection } = state
  const toggleType = schema.nodes.toggle
  const summaryType = schema.nodes.toggleSummary
  const contentType = schema.nodes.toggleContent
  const paraType = schema.nodes.paragraph
  if (!toggleType || !summaryType || !contentType || !paraType) return null

  const { $from } = selection
  if ($from.depth < 1) return null

  const block = $from.node(1)
  if (!block.isTextblock || block.type === summaryType) return null

  const start = $from.before(1)
  const end = $from.after(1)

  const summary = summaryType.create(null, block.content)
  const body = contentType.create(null, paraType.create())
  const toggleNode = toggleType.create({ open: true }, [summary, body])

  const tr = state.tr.replaceWith(start, end, toggleNode)
  const selPos = Math.min(start + 2 + summary.content.size, tr.doc.content.size)
  tr.setSelection(TextSelection.create(tr.doc, selPos))
  return tr
}

/**
 * Build the transaction that unwraps the toggle enclosing the selection back
 * into a paragraph (from its summary) followed by its body blocks. Returns null
 * when the selection is not inside a toggle.
 */
export function buildUnsetToggleTr(state: EditorState): Transaction | null {
  const { $from } = state.selection
  const depth = ancestorDepth($from, 'toggle')
  if (depth === -1) return null

  const paraType = state.schema.nodes.paragraph
  if (!paraType) return null

  const pos = $from.before(depth)
  const toggleNode = $from.node(depth)
  const summaryNode = toggleNode.child(0)
  const contentNode = toggleNode.child(1)

  const replacement: PMNode[] = [paraType.create(null, summaryNode.content)]
  contentNode.forEach((child) => replacement.push(child))

  const tr = state.tr.replaceWith(pos, pos + toggleNode.nodeSize, replacement)
  tr.setSelection(TextSelection.create(tr.doc, pos + 1))
  return tr
}

/** React view: absolute chevron in the gutter + the summary/body content. */
function ToggleView(props: ReactNodeViewProps) {
  const { node, updateAttributes, editor, getPos } = props
  const open = node.attrs.open !== false

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Collapsing a section is view state, not a content edit — keep it out of
      // the undo stack (same reasoning as the heading fold in
      // collapsible-heading.tsx). Fall back to updateAttributes if the position
      // is momentarily unresolved.
      const pos = typeof getPos === 'function' ? getPos() : null
      if (pos == null) {
        updateAttributes({ open: !open })
        return
      }
      const tr = editor.state.tr.setNodeAttribute(pos, 'open', !open)
      tr.setMeta('addToHistory', false)
      editor.view.dispatch(tr)
    },
    [open, updateAttributes, editor, getPos]
  )

  return (
    <NodeViewWrapper
      className={`toggle-block${open ? ' is-open' : ' is-closed'}`}
      data-open={open ? 'true' : 'false'}
    >
      <button
        type="button"
        className="toggle-chevron text-muted-foreground/60 hover:text-foreground hover:bg-accent"
        onClick={handleToggle}
        contentEditable={false}
        aria-label={open ? 'Collapse toggle' : 'Expand toggle'}
      >
        <ChevronRight
          className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          size={16}
        />
      </button>
      <NodeViewContent className="toggle-inner" />
    </NodeViewWrapper>
  )
}

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'toggleSummary toggleContent',
  isolating: true,
  defining: true,
  selectable: true,
  draggable: true,

  // --- Markdown round-trip (see toggle-markdown.ts) ---
  markdownTokenName: TOGGLE_TOKEN,
  markdownTokenizer: toggleMarkdownTokenizer,
  parseMarkdown: parseToggleMarkdown,
  renderMarkdown: renderToggleMarkdown,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el: HTMLElement) => el.hasAttribute('open'),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.open ? { open: '' } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'details' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['details', mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView)
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ state, dispatch }) => {
          const tr = buildSetToggleTr(state)
          if (!tr) return false
          if (dispatch) dispatch(tr.scrollIntoView())
          return true
        },

      unsetToggle:
        () =>
        ({ state, dispatch }) => {
          const tr = buildUnsetToggleTr(state)
          if (!tr) return false
          if (dispatch) dispatch(tr.scrollIntoView())
          return true
        },
    }
  },

  addInputRules() {
    // `<` + space at the start of a block → toggle. The mirror of Notion's `>`,
    // which StarterKit's blockquote already claims. Typography's `<<`/`<-` rules
    // need a non-space second char, so a lone `< ` collides with nothing.
    return [
      new InputRule({
        find: /^<\s$/,
        handler: ({ chain, range }) => {
          chain().deleteRange(range).setToggle().run()
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor
        const { selection } = state
        if (!selection.empty) return false
        const { $from } = selection

        // In the summary: hop into the body's first block.
        const summaryDepth = ancestorDepth($from, 'toggleSummary')
        if (summaryDepth !== -1) {
          const toggleDepth = summaryDepth - 1
          const togglePos = $from.before(toggleDepth)
          const summaryNode = $from.node(toggleDepth).child(0)
          const bodyStart = togglePos + 1 + summaryNode.nodeSize + 1
          const tr = state.tr.setSelection(
            Selection.near(state.doc.resolve(bodyStart))
          )
          this.editor.view.dispatch(tr.scrollIntoView())
          return true
        }

        // On an empty trailing body line: step out of the toggle entirely.
        const contentDepth = ancestorDepth($from, 'toggleContent')
        if (contentDepth !== -1) {
          const block = $from.parent
          const isEmptyPara =
            block.type.name === 'paragraph' && block.content.size === 0
          const contentNode = $from.node(contentDepth)
          const isLastChild = $from.index(contentDepth) === contentNode.childCount - 1
          if (isEmptyPara && isLastChild) {
            const toggleDepth = contentDepth - 1
            const after = $from.after(toggleDepth)
            const paraType = state.schema.nodes.paragraph
            if (paraType) {
              const tr = state.tr.insert(after, paraType.create())
              tr.setSelection(TextSelection.create(tr.doc, after + 1))
              this.editor.view.dispatch(tr.scrollIntoView())
              return true
            }
          }
        }

        return false
      },

      Backspace: () => {
        const { state } = this.editor
        const { selection } = state
        if (!selection.empty) return false
        const { $from } = selection

        // At the very start of the summary: unwrap the toggle.
        const summaryDepth = ancestorDepth($from, 'toggleSummary')
        if (summaryDepth !== -1 && $from.parentOffset === 0) {
          return this.editor.commands.unsetToggle()
        }

        // At the start of the first body block: hop back up to the summary
        // instead of letting a cross-boundary join mangle the structure.
        const contentDepth = ancestorDepth($from, 'toggleContent')
        if (
          contentDepth !== -1 &&
          $from.parentOffset === 0 &&
          $from.index(contentDepth) === 0
        ) {
          const toggleDepth = contentDepth - 1
          const togglePos = $from.before(toggleDepth)
          const summaryNode = $from.node(toggleDepth).child(0)
          const summaryEnd = togglePos + 2 + summaryNode.content.size
          const tr = state.tr.setSelection(
            TextSelection.create(state.doc, summaryEnd)
          )
          this.editor.view.dispatch(tr.scrollIntoView())
          return true
        }

        return false
      },
    }
  },
})

export const ToggleSummary = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'summary' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['summary', mergeAttributes(HTMLAttributes, { class: 'toggle-summary' }), 0]
  },
})

export const ToggleContent = Node.create({
  name: 'toggleContent',
  content: 'block+',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="toggle-content"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'toggle-content' }),
      0,
    ]
  },
})
