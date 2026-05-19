'use client'

import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
} from '@tiptap/suggestion'
import { createSuggestionPopupRenderer } from '../suggestion/renderer'
import { MentionMenuList } from './popup'
import type { MentionItem } from './types'

// Distinct PluginKey so this Suggestion plugin doesn't collide with the
// slash and PR menus — Tiptap's `Suggestion` defaults to a shared
// `suggestion$` key, which ProseMirror rejects when more than one
// instance lives in the same editor.
const MENTION_MENU_PLUGIN_KEY = new PluginKey('mentionMenuSuggestion')

interface MentionMenuOptions {
  /**
   * Getter for the current file/folder list. Wrapped in a closure so
   * the extension always sees the latest TanStack Query data even
   * though the editor's options are frozen at create time.
   */
  getEntries?: () => MentionItem[]
}

const MAX_RESULTS = 50
const COMMON_NOISE_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  '.turbo',
  '.cache',
])

function rankItems(entries: MentionItem[], query: string): MentionItem[] {
  if (!query) {
    // No query: show files first (they're what AI agents reference
    // most often), then folders. Filter out the heavy build dirs so a
    // bare `@` doesn't dump 5000 node_modules entries on the user.
    const filtered = entries.filter((e) => {
      const top = e.path.split('/')[0] ?? ''
      return !COMMON_NOISE_DIRS.has(top)
    })
    const files = filtered.filter((e) => e.kind === 'file').slice(0, MAX_RESULTS)
    const dirs = filtered.filter((e) => e.kind === 'dir').slice(0, MAX_RESULTS - files.length)
    return [...files, ...dirs]
  }

  const q = query.toLowerCase()
  type Scored = { item: MentionItem; score: number }
  const scored: Scored[] = []
  for (const e of entries) {
    const lowerPath = e.path.toLowerCase()
    const lowerName = e.name.toLowerCase()
    let score: number
    if (lowerName === q) score = 0
    else if (lowerName.startsWith(q)) score = 1
    else if (lowerPath.endsWith('/' + q)) score = 2
    else if (lowerName.includes(q)) score = 3
    else if (lowerPath.includes(q)) score = 4
    else continue
    scored.push({ item: e, score })
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    if (a.item.kind !== b.item.kind) return a.item.kind === 'file' ? -1 : 1
    return a.item.path.length - b.item.path.length
  })
  return scored.slice(0, MAX_RESULTS).map((s) => s.item)
}

/**
 * Tiptap extension that opens an @-mention popover when the user
 * types `@`. Items are worktree files and folders, sourced from the
 * session tree on the React side (`useSessionTree`).
 *
 * Selecting an item replaces the `@<query>` range with `@<path> `
 * so the agent receives a stable, parseable reference (same shape
 * as Claude Code / Cursor / Conductor). The leading `@` is kept so
 * it remains visible in the composer.
 */
export const MentionMenuExtension = Extension.create<MentionMenuOptions>({
  name: 'mentionMenu',

  // Same priority as the slash menu so Enter on an open suggestion
  // selects an item rather than submitting the partial message.
  priority: 200,

  addOptions() {
    return { getEntries: undefined }
  },

  addProseMirrorPlugins() {
    const getEntries = () => this.options.getEntries?.() ?? []

    const suggestion: Partial<SuggestionOptions<MentionItem, MentionItem>> = {
      pluginKey: MENTION_MENU_PLUGIN_KEY,
      char: '@',
      // Paths never contain spaces in normal repos — bail the suggestion
      // when the user types one so they can keep writing normal prose.
      allowSpaces: false,
      // `@` can appear mid-sentence ("look @ this") so we do NOT require
      // start-of-line, unlike slash commands.
      startOfLine: false,
      items: ({ query }: { query: string }) => rankItems(getEntries(), query),
      command: ({
        editor,
        range,
        props: item,
      }: {
        editor: SuggestionProps<MentionItem>['editor']
        range: { from: number; to: number }
        props: MentionItem
      }) => {
        // Drop the `@<query>` range, insert a chip carrying the full
        // path metadata, then a single trailing space so the user can
        // keep typing without nudging past the chip.
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertMentionChip(item)
          .insertContent(' ')
          .run()
      },
      render: createSuggestionPopupRenderer<MentionItem>(MentionMenuList),
    }

    return [
      Suggestion<MentionItem, MentionItem>({
        editor: this.editor,
        ...suggestion,
      }),
    ]
  },
})
