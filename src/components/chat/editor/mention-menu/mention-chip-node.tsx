/**
 * Inline file/folder mention chip — a Tiptap atom that renders as
 * `[icon] basename` inline in the composer. Inserted by the `@`
 * suggestion (`mention-menu/extension.ts`).
 *
 * Carries the full worktree-relative path in its attrs so the
 * serializer emits `@<path>` regardless of how the display name
 * looks. The chip is what the user sees; the path is what the agent
 * receives.
 *
 * Backspace adjacent to (or on) the chip deletes it and restores `@`
 * at that position so the mention menu re-opens — matches the
 * Cursor / Conductor "fat-finger forgiveness" UX.
 */

import { Node, mergeAttributes, type NodeViewProps } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FileIcon, FolderIcon } from '@/components/file-icon'
import { handleChipBackspace } from '../suggestion/chip-backspace'
import type { MentionItem } from './types'

export const MENTION_CHIP_NAME = 'mentionChip'

/**
 * Attrs mirror `MentionItem` — the chip is self-describing so the
 * serializer can produce the `@<path>` wire format without
 * re-consulting the tree.
 */
export type MentionChipAttrs = MentionItem

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mentionChip: {
      /** Insert a file/folder mention chip at the current cursor. */
      insertMentionChip: (attrs: MentionChipAttrs) => ReturnType
    }
  }
}

export const MentionChipNode = Node.create<{}>({
  name: MENTION_CHIP_NAME,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      path: { default: '' },
      name: { default: '' },
      kind: { default: 'file' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-mention-chip]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-mention-chip': 'true' })]
  },

  addCommands() {
    return {
      insertMentionChip:
        (attrs: MentionChipAttrs) =>
        ({ commands }) =>
          commands.insertContent({ type: MENTION_CHIP_NAME, attrs }),
    }
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => handleChipBackspace(editor, MENTION_CHIP_NAME, '@'),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionChipView)
  },
})

function MentionChipView({ node, editor, getPos, selected }: NodeViewProps) {
  const attrs = node.attrs as MentionChipAttrs

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

  // Tooltip carries the full path so the user can disambiguate two
  // files with the same basename in different directories.
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-drag-handle="false"
      className={cn(
        'inline-flex items-center align-baseline gap-1 px-1.5 py-0.5 mx-0.5',
        'rounded-md border bg-muted/40 text-foreground text-[12px] font-medium',
        'border-border hover:border-foreground/30 transition-colors',
        'cursor-default select-none',
        selected && 'ring-2 ring-primary/40 border-primary/40',
      )}
      title={attrs.path}
    >
      {attrs.kind === 'dir' ? (
        <FolderIcon name={attrs.name} opened={false} size={11} />
      ) : (
        <FileIcon name={attrs.name} size={11} />
      )}
      <span className="font-mono text-[11px] truncate max-w-[180px]">{attrs.name}</span>
      <button
        type="button"
        onMouseDown={handleRemove}
        className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
        aria-label={`Remove @${attrs.path}`}
        tabIndex={-1}
      >
        <X size={10} />
      </button>
    </NodeViewWrapper>
  )
}
