'use client'

import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
} from '@tiptap/suggestion'
import { createSuggestionPopupRenderer } from '../suggestion/renderer'
import { MentionMenuList } from './popup'
import type { MentionItem, FileMentionItem, TaskMentionItem, NoteMentionItem } from './types'

// Distinct PluginKey so this Suggestion plugin doesn't collide with the
// slash and PR menus — Tiptap's `Suggestion` defaults to a shared
// `suggestion$` key, which ProseMirror rejects when more than one
// instance lives in the same editor.
const MENTION_MENU_PLUGIN_KEY = new PluginKey('mentionMenuSuggestion')

interface MentionMenuOptions {
  /**
   * Worktree files + folders. Wrapped in a closure so the extension
   * always sees the latest TanStack Query data without re-creating the
   * editor when the tree refreshes.
   */
  getFileEntries?: () => FileMentionItem[]
  /** Tasks for the current session's workspace. */
  getTasks?: () => TaskMentionItem[]
  /** Notes for the current session's workspace. */
  getNotes?: () => NoteMentionItem[]
}

const MAX_FILES = 30
const MAX_TASKS = 15
const MAX_NOTES = 15
const COMMON_NOISE_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  '.turbo',
  '.cache',
])

function scoreFile(item: FileMentionItem, q: string): number {
  const lowerPath = item.path.toLowerCase()
  const lowerName = item.name.toLowerCase()
  if (lowerName === q) return 0
  if (lowerName.startsWith(q)) return 1
  if (lowerPath.endsWith('/' + q)) return 2
  if (lowerName.includes(q)) return 3
  if (lowerPath.includes(q)) return 4
  return Infinity
}

function scoreText(text: string, q: string): number {
  const lower = text.toLowerCase()
  if (lower === q) return 0
  if (lower.startsWith(q)) return 1
  if (lower.includes(q)) return 2
  return Infinity
}

function rankFiles(entries: FileMentionItem[], query: string): FileMentionItem[] {
  if (!query) {
    const filtered = entries.filter((e) => {
      const top = e.path.split('/')[0] ?? ''
      return !COMMON_NOISE_DIRS.has(top)
    })
    const files = filtered.filter((e) => e.kind === 'file').slice(0, MAX_FILES)
    const dirs = filtered.filter((e) => e.kind === 'dir').slice(0, MAX_FILES - files.length)
    return [...files, ...dirs]
  }
  const q = query.toLowerCase()
  return entries
    .map((item) => ({ item, score: scoreFile(item, q) }))
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score
      if (a.item.kind !== b.item.kind) return a.item.kind === 'file' ? -1 : 1
      return a.item.path.length - b.item.path.length
    })
    .slice(0, MAX_FILES)
    .map((s) => s.item)
}

function rankTasks(tasks: TaskMentionItem[], query: string): TaskMentionItem[] {
  if (!query) {
    // Active first; within each status keep stored order (server returns
    // by recency).
    const active = tasks.filter((t) => t.status === 'active')
    const rest = tasks.filter((t) => t.status !== 'active')
    return [...active, ...rest].slice(0, MAX_TASKS)
  }
  const q = query.toLowerCase()
  return tasks
    .map((item) => ({ item, score: scoreText(item.title, q) }))
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score
      // Tiebreak: active tasks before done/archived.
      const aActive = a.item.status === 'active' ? 0 : 1
      const bActive = b.item.status === 'active' ? 0 : 1
      return aActive - bActive
    })
    .slice(0, MAX_TASKS)
    .map((s) => s.item)
}

function rankNotes(notes: NoteMentionItem[], query: string): NoteMentionItem[] {
  if (!query) return notes.slice(0, MAX_NOTES)
  const q = query.toLowerCase()
  return notes
    .map((item) => ({ item, score: scoreText(item.title, q) }))
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_NOTES)
    .map((s) => s.item)
}

/**
 * Build the full picker list — entity options come first (scratchpad
 * always, then tasks then notes), followed by file matches. The user
 * almost always wants scratchpad / a known task before they want a
 * file path; files tend to be longer + more specific and surface
 * naturally as the query narrows.
 */
function buildItems(
  files: FileMentionItem[],
  tasks: TaskMentionItem[],
  notes: NoteMentionItem[],
  query: string,
): MentionItem[] {
  const q = query.toLowerCase()
  const out: MentionItem[] = []

  // Scratchpad: surface when the query is empty OR matches "scratch" /
  // "pad" / "scratchpad". Filtering instead of always-present so the
  // option doesn't clutter every search.
  if (!q || 'scratchpad'.includes(q) || 'pad'.includes(q)) {
    out.push({ kind: 'scratchpad' })
  }

  for (const t of rankTasks(tasks, query)) out.push(t)
  for (const n of rankNotes(notes, query)) out.push(n)
  for (const f of rankFiles(files, query)) out.push(f)
  return out
}

/**
 * Tiptap extension that opens an `@`-picker covering files / tasks /
 * notes / scratchpad. One trigger, four kinds — the popup renders
 * results in sections so visual scanning stays fast.
 *
 * Selecting a file inserts a `MentionChipNode` (the existing chip —
 * serialized to `@<path>` on send). Selecting a task / note / scratchpad
 * inserts an `EntityChipNode` (serialized to `[[task:id]]` / `[[note:id]]`
 * / `[[scratchpad]]`).
 */
export const MentionMenuExtension = Extension.create<MentionMenuOptions>({
  name: 'mentionMenu',

  // Same priority as the slash menu so Enter on an open suggestion
  // selects an item rather than submitting the partial message.
  priority: 200,

  addOptions() {
    return { getFileEntries: undefined, getTasks: undefined, getNotes: undefined }
  },

  addProseMirrorPlugins() {
    const getFiles = () => this.options.getFileEntries?.() ?? []
    const getTasks = () => this.options.getTasks?.() ?? []
    const getNotes = () => this.options.getNotes?.() ?? []

    const suggestion: Partial<SuggestionOptions<MentionItem, MentionItem>> = {
      pluginKey: MENTION_MENU_PLUGIN_KEY,
      char: '@',
      // Paths never contain spaces; entity queries are also single-token.
      allowSpaces: false,
      // `@` can appear mid-sentence; the picker fires from any position.
      startOfLine: false,
      items: ({ query }: { query: string }) =>
        buildItems(getFiles(), getTasks(), getNotes(), query),
      command: ({
        editor,
        range,
        props: item,
      }: {
        editor: SuggestionProps<MentionItem>['editor']
        range: { from: number; to: number }
        props: MentionItem
      }) => {
        const chain = editor.chain().focus().deleteRange(range)
        if (item.kind === 'file' || item.kind === 'dir') {
          chain.insertMentionChip(item).insertContent(' ').run()
        } else if (item.kind === 'scratchpad') {
          chain
            .insertEntityChip({ kind: 'scratchpad', id: '', title: 'Scratchpad' })
            .insertContent(' ')
            .run()
        } else if (item.kind === 'task') {
          chain
            .insertEntityChip({
              kind: 'task',
              id: item.id,
              title: item.title,
              status: item.status,
            })
            .insertContent(' ')
            .run()
        } else if (item.kind === 'note') {
          chain
            .insertEntityChip({ kind: 'note', id: item.id, title: item.title })
            .insertContent(' ')
            .run()
        }
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
