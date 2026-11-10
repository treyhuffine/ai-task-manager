/**
 * Inline PR chip — a Tiptap atom node that renders as `[icon] #193`
 * inline in the composer flow. Sibling to FileChipNode (file
 * attachments) but for GitHub PR references. The chip carries the
 * full PR metadata in its attrs so serialization doesn't depend on
 * the menu's cache being fresh at send time.
 *
 * Inserted from the `@#` picker (`mention-menu`). Serialized to a
 * single canonical context line via `formatPrRef`, so downstream code
 * only ever sees one shape on the wire regardless of how the chip was
 * composed. Its sibling for issues is `IssueChipNode`.
 */

import { Node, mergeAttributes, type NodeViewProps } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { handleChipBackspace } from '../suggestion/chip-backspace'
import { MENTION_GITHUB_TRIGGER } from '../mention-menu/github-trigger'
import { GithubRefChip } from './github-chip'
import { PrStateIcon } from './state-icons'
import type { PrMentionItem } from './types'

/** Saved drafts store the node by this name, so it never changes. */
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

export const PrChipNode = Node.create<Record<string, never>>({
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
      // Backspacing a PR chip re-inserts `@#` so the mention picker
      // reopens on issues and PRs — the user can swap to a different one
      // without retyping the trigger, matching every other chip's behavior.
      Backspace: ({ editor }) => handleChipBackspace(editor, PR_CHIP_NAME, MENTION_GITHUB_TRIGGER),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(PrChipView)
  },
})

function PrChipView({ node, editor, getPos, selected }: NodeViewProps) {
  const attrs = node.attrs as PrChipAttrs
  return (
    <GithubRefChip
      node={node}
      editor={editor}
      getPos={getPos}
      selected={selected}
      icon={<PrStateIcon state={attrs.state} isDraft={attrs.isDraft} />}
      tooltip={`${attrs.title}${attrs.headRefName ? `\n${attrs.headRefName}` : ''}`}
      noun="PR"
    />
  )
}
