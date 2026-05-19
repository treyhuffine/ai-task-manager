/**
 * Inline PR chip — a Tiptap atom node that renders as `[icon] #193`
 * inline in the composer flow. Sibling to FileChipNode (file
 * attachments) but for GitHub PR references. The chip carries the
 * full PR metadata in its attrs so serialization doesn't depend on
 * the menu's cache being fresh at send time.
 *
 * Inserted by the `#`-mention suggestion (`pr-menu/extension.ts`).
 * Serialized to the same expanded text the manual `#193` typing path
 * produces (via `formatPrRef`), so downstream code only ever sees one
 * canonical shape on the wire.
 */

import { Node, mergeAttributes, type NodeViewProps } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import {
  X,
  GitPullRequest,
  GitPullRequestDraft,
  GitPullRequestClosed,
  GitMerge,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { handleChipBackspace } from '../suggestion/chip-backspace'
import type { PrMentionItem } from './types'

export const PR_CHIP_NAME = 'prChip'

/**
 * Attrs mirror `PrMentionItem` — the chip is self-describing so the
 * serializer can produce the expanded ref text without re-consulting
 * the PR list cache.
 */
export type PrChipAttrs = PrMentionItem

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    prChip: {
      /** Insert a PR chip at the current cursor position. */
      insertPrChip: (attrs: PrChipAttrs) => ReturnType
    }
  }
}

export const PrChipNode = Node.create<{}>({
  name: PR_CHIP_NAME,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      number: { default: 0 },
      title: { default: '' },
      state: { default: 'OPEN' },
      isDraft: { default: false },
      headRefName: { default: '' },
      baseRefName: { default: '' },
      url: { default: '' },
      updatedAt: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-pr-chip]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-pr-chip': 'true' })]
  },

  addCommands() {
    return {
      insertPrChip:
        (attrs: PrChipAttrs) =>
        ({ commands }) =>
          commands.insertContent({ type: PR_CHIP_NAME, attrs }),
    }
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => handleChipBackspace(editor, PR_CHIP_NAME, '#'),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(PrChipView)
  },
})

function stateIconForChip(attrs: PrChipAttrs) {
  if (attrs.state === 'MERGED') {
    return <GitMerge size={11} className="text-violet-500 dark:text-violet-400 shrink-0" />
  }
  if (attrs.state === 'CLOSED') {
    return (
      <GitPullRequestClosed size={11} className="text-rose-500 dark:text-rose-400 shrink-0" />
    )
  }
  if (attrs.isDraft) {
    return <GitPullRequestDraft size={11} className="text-muted-foreground/80 shrink-0" />
  }
  return <GitPullRequest size={11} className="text-emerald-500 dark:text-emerald-400 shrink-0" />
}

function PrChipView({ node, editor, getPos, selected }: NodeViewProps) {
  const attrs = node.attrs as PrChipAttrs

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

  // Tooltip carries the title + branch so the user can confirm what
  // they referenced without leaving the composer.
  const tooltip = `${attrs.title}${attrs.headRefName ? `\n${attrs.headRefName}` : ''}`

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
      title={tooltip}
    >
      {stateIconForChip(attrs)}
      <span className="font-mono text-[11px]">#{attrs.number}</span>
      <button
        type="button"
        onMouseDown={handleRemove}
        className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
        aria-label={`Remove PR #${attrs.number}`}
        tabIndex={-1}
      >
        <X size={10} />
      </button>
    </NodeViewWrapper>
  )
}
