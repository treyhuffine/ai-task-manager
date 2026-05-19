'use client'

import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
} from '@tiptap/suggestion'
import { createSuggestionPopupRenderer } from '../suggestion/renderer'
import { PrMenuList } from './popup'
import type { PrMentionItem } from './types'

// Distinct PluginKey so this Suggestion plugin doesn't collide with the
// slash and @-mention menus — Tiptap's `Suggestion` defaults to a
// shared `suggestion$` key, which ProseMirror rejects when more than
// one instance lives in the same editor.
const PR_MENU_PLUGIN_KEY = new PluginKey('prMenuSuggestion')

interface PrMenuOptions {
  /**
   * Getter for the current PR list. Wrapped in a closure so the
   * extension always sees the latest TanStack Query data even though
   * the editor's options are frozen at create time.
   */
  getPrs?: () => PrMentionItem[]
}

const MAX_RESULTS = 30

function rankItems(prs: PrMentionItem[], query: string): PrMentionItem[] {
  if (!query) return prs.slice(0, MAX_RESULTS)

  const q = query.toLowerCase()
  // Pure-digit query → filter by number prefix. Avoids the awkward
  // "user typed `#22` and got #22, #221, #222, #322" ordering.
  if (/^\d+$/.test(query)) {
    const exact: PrMentionItem[] = []
    const startsWith: PrMentionItem[] = []
    const contains: PrMentionItem[] = []
    for (const p of prs) {
      const num = String(p.number)
      if (num === query) exact.push(p)
      else if (num.startsWith(query)) startsWith.push(p)
      else if (num.includes(query)) contains.push(p)
    }
    return [...exact, ...startsWith, ...contains].slice(0, MAX_RESULTS)
  }

  // Text query → title or branch substring.
  type Scored = { item: PrMentionItem; score: number }
  const scored: Scored[] = []
  for (const p of prs) {
    const title = p.title.toLowerCase()
    const branch = p.headRefName.toLowerCase()
    let score: number
    if (title.startsWith(q)) score = 0
    else if (title.includes(q)) score = 1
    else if (branch.includes(q)) score = 2
    else continue
    scored.push({ item: p, score })
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    // Tiebreak by recency (popup feed is already sorted newest-first).
    return a.item.updatedAt < b.item.updatedAt ? 1 : -1
  })
  return scored.slice(0, MAX_RESULTS).map((s) => s.item)
}

/**
 * Tiptap extension that opens a PR-mention popover when the user
 * types `#`. Items come from `gh pr list` via `useSessionTree`'s
 * sibling `usePrList` hook on the consumer side.
 *
 * Selecting an item replaces the `#<query>` range with `#<number> `
 * so the agent receives a numeric reference Claude Code / Codex /
 * `gh` all understand natively.
 */
export const PrMenuExtension = Extension.create<PrMenuOptions>({
  name: 'prMenu',

  // Same priority as the slash + mention menus so Enter on an open
  // suggestion selects the PR rather than submitting `#22` as text.
  priority: 200,

  addOptions() {
    return { getPrs: undefined }
  },

  addProseMirrorPlugins() {
    const getPrs = () => this.options.getPrs?.() ?? []

    const suggestion: Partial<SuggestionOptions<PrMentionItem, PrMentionItem>> = {
      pluginKey: PR_MENU_PLUGIN_KEY,
      char: '#',
      allowSpaces: false,
      // Don't require start-of-line — `#22` and "see #22" are both
      // valid spots for a reference.
      startOfLine: false,
      items: ({ query }: { query: string }) => rankItems(getPrs(), query),
      command: ({
        editor,
        range,
        props: pr,
      }: {
        editor: SuggestionProps<PrMentionItem>['editor']
        range: { from: number; to: number }
        props: PrMentionItem
      }) => {
        // Drop the `#<query>` range, insert a chip carrying the full
        // PR metadata, then a single trailing space so the user can
        // keep typing without having to nudge past the chip.
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertPrChip(pr)
          .insertContent(' ')
          .run()
      },
      render: createSuggestionPopupRenderer<PrMentionItem>(PrMenuList),
    }

    return [
      Suggestion<PrMentionItem, PrMentionItem>({
        editor: this.editor,
        ...suggestion,
      }),
    ]
  },
})
