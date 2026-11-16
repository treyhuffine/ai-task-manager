/**
 * Inline slash-command badge — a Tiptap atom node rendered as a compact
 * pill (`/name`) at the start of the composer. Inserted by the `/`
 * suggestion (`slash-menu/extension.ts`) or when a known leading
 * `/command` is completed with a space.
 *
 * Serializes back to `/<name>` in `buildMarkerOutput` and
 * `buildUiMessageParts`, preserving native slash-command syntax for
 * every harness while making the recognized command visually distinct.
 *
 * Backspace adjacent to (or on) the badge removes it and restores `/`
 * so the slash menu reopens immediately.
 */

import { Node, mergeAttributes, type NodeViewProps } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { Terminal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tip } from '@/components/ui/tip'
import { handleChipBackspace } from '../suggestion/chip-backspace'

export const SLASH_CHIP_NAME = 'slashChip'

export interface SlashChipAttrs {
  name: string
  description?: string
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    slashChip: {
      /** Insert a slash-command badge at the current cursor position. */
      insertSlashChip: (attrs: SlashChipAttrs) => ReturnType
    }
  }
}

export const SlashChipNode = Node.create<Record<string, never>>({
  name: SLASH_CHIP_NAME,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      name: { default: '' },
      description: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-slash-chip]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-slash-chip': 'true' }), `/${node.attrs.name}`]
  },

  renderText({ node }) {
    return `/${node.attrs.name}`
  },

  addCommands() {
    return {
      insertSlashChip:
        (attrs: SlashChipAttrs) =>
        ({ commands }) =>
          commands.insertContent({ type: SLASH_CHIP_NAME, attrs }),
    }
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => handleChipBackspace(editor, SLASH_CHIP_NAME, '/'),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(SlashChipView)
  },
})

function SlashChipView({ node, editor, getPos, selected }: NodeViewProps) {
  const attrs = node.attrs as SlashChipAttrs
  const label = `/${attrs.name}`
  const tip = attrs.description?.trim() || label

  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (typeof getPos !== 'function') return
    const pos = getPos()
    if (pos == null) return
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run()
  }

  return (
    <Tip label={tip} onlyWhenTextHidden={!attrs.description?.trim()}>
      <NodeViewWrapper
        as="span"
        contentEditable={false}
        data-drag-handle="false"
        data-slash-command={attrs.name}
        className={cn(
          'inline-flex items-center align-baseline gap-1 px-1.5 py-0.5 mr-0.5',
          'rounded-md border bg-primary/10 text-foreground text-[12px] font-medium',
          'border-primary/25 hover:border-primary/45 transition-colors',
          'cursor-default select-none',
          selected && 'ring-2 ring-primary/40 border-primary/50',
        )}
      >
        <Terminal size={11} className="text-primary/80 shrink-0" />
        <span className="self-baseline font-mono text-[11px] truncate max-w-[200px]">
          {label}
        </span>
        <button
          type="button"
          onMouseDown={handleRemove}
          className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
          aria-label={`Remove ${label}`}
          tabIndex={-1}
        >
          <X size={10} />
        </button>
      </NodeViewWrapper>
    </Tip>
  )
}
