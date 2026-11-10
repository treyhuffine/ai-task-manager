/**
 * Inline issue chip — the PR chip's sibling for GitHub issues, rendered as
 * `[icon] #412` in the composer. It carries the issue's title, state and
 * link in its attrs, so it serializes (`formatIssueRef`) without the issue
 * list being fresh at send time.
 *
 * Inserted from the `@#` picker (`mention-menu`), where issues and pull
 * requests share one list as they share one number space on GitHub.
 */

import { Node, mergeAttributes, type NodeViewProps } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { handleChipBackspace } from '../suggestion/chip-backspace'
import { MENTION_GITHUB_TRIGGER } from '../mention-menu/github-trigger'
import { GithubRefChip } from './github-chip'
import { IssueStateIcon } from './state-icons'
import type { IssueMentionItem } from './types'

/** Saved drafts store the node by this name, so it never changes. */
export const ISSUE_CHIP_NAME = 'issueChip'

/** Attrs mirror `IssueMentionItem`, so the chip describes itself. */
export type IssueChipAttrs = IssueMentionItem

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    issueChip: {
      /** Insert an issue chip at the current cursor position. */
      insertIssueChip: (attrs: IssueChipAttrs) => ReturnType
    }
  }
}

export const IssueChipNode = Node.create<Record<string, never>>({
  name: ISSUE_CHIP_NAME,
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
      url: { default: '' },
      updatedAt: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-issue-chip]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-issue-chip': 'true' })]
  },

  addCommands() {
    return {
      insertIssueChip:
        (attrs: IssueChipAttrs) =>
        ({ commands }) =>
          commands.insertContent({ type: ISSUE_CHIP_NAME, attrs }),
    }
  },

  addKeyboardShortcuts() {
    return {
      // Like the PR chip: Backspace leaves `@#` behind, so the picker
      // reopens on issues and PRs to swap in a different one.
      Backspace: ({ editor }) => handleChipBackspace(editor, ISSUE_CHIP_NAME, MENTION_GITHUB_TRIGGER),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(IssueChipView)
  },
})

function IssueChipView({ node, editor, getPos, selected }: NodeViewProps) {
  const attrs = node.attrs as IssueChipAttrs
  return (
    <GithubRefChip
      node={node}
      editor={editor}
      getPos={getPos}
      selected={selected}
      icon={<IssueStateIcon state={attrs.state} />}
      tooltip={attrs.title}
      noun="issue"
    />
  )
}
