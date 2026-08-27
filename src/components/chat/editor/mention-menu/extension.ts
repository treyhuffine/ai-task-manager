'use client'

import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
} from '@tiptap/suggestion'
import { createSuggestionPopupRenderer } from '../suggestion/renderer'
import { MentionMenuList } from './popup'
import { buildItems, parseReferenceDrillDown, toReferenceFileItems } from './ranking'
import type {
  MentionItem,
  FileMentionItem,
  TaskMentionItem,
  NoteMentionItem,
  ReferenceFolderMentionItem,
} from './types'
import type { PrMentionItem } from '../pr-menu/types'

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
  /**
   * Reference folders visible from this session's workspace
   * (docs/reference-folders-spec.md §8). Read-only folders outside the
   * worktree that the agent has been told about.
   */
  getReferenceFolders?: () => ReferenceFolderMentionItem[]
  /**
   * Fetch one reference folder's file list. Called only when the user has
   * actually drilled in (`@alias/`), so a workspace with references pays
   * nothing until someone browses one. Expected to cache — `items` runs on
   * every keystroke inside the drill-down.
   */
  loadReferenceTree?: (referenceId: string) => Promise<FileMentionItem[]>
  /**
   * GitHub pull requests, surfaced when the query opens with `#` (`@#`).
   * Wrapped in a closure so the extension always sees the latest
   * `usePrList` data without re-creating the editor. Empty (or omitted)
   * when gh is missing / unauthenticated or the workspace is non-git — the
   * `@#` filter just shows its empty state there.
   */
  getPrs?: () => PrMentionItem[]
}

/**
 * Tiptap extension that opens an `@`-picker covering files / tasks / notes /
 * scratchpad / reference folders / pull requests. One trigger, six kinds — the
 * popup renders results in sections so visual scanning stays fast. Ranking
 * lives in `./ranking`, which is deliberately free of Tiptap so it can be
 * tested alone.
 *
 * Selecting a file inserts a `MentionChipNode` (the existing chip —
 * serialized to `@<path>` on send). Selecting a task / note / scratchpad
 * inserts an `EntityChipNode` (serialized to `[[task:id]]` / `[[note:id]]`
 * / `[[scratchpad]]`). Selecting a PR inserts a `PrChipNode` (serialized to
 * a full context line via `formatPrRef`). Selecting a reference folder
 * inserts nothing: it rewrites the query to `@<alias>/` so the picker
 * retargets into that folder.
 *
 * PRs are gated behind a `#` after the `@` (`@#193`) — see `pr-trigger.ts`.
 * This replaced a standalone `#` trigger whose send-time raw-text expansion
 * surprised users by rewriting numbers they meant literally.
 */
export const MentionMenuExtension = Extension.create<MentionMenuOptions>({
  name: 'mentionMenu',

  // Same priority as the slash menu so Enter on an open suggestion
  // selects an item rather than submitting the partial message.
  priority: 200,

  addOptions() {
    return {
      getFileEntries: undefined,
      getTasks: undefined,
      getNotes: undefined,
      getReferenceFolders: undefined,
      loadReferenceTree: undefined,
      getPrs: undefined,
    }
  },

  addProseMirrorPlugins() {
    const getFiles = () => this.options.getFileEntries?.() ?? []
    const getTasks = () => this.options.getTasks?.() ?? []
    const getNotes = () => this.options.getNotes?.() ?? []
    const getReferences = () => this.options.getReferenceFolders?.() ?? []
    const getPrs = () => this.options.getPrs?.() ?? []
    const loadReferenceTree = this.options.loadReferenceTree

    const suggestion: Partial<SuggestionOptions<MentionItem, MentionItem>> = {
      pluginKey: MENTION_MENU_PLUGIN_KEY,
      char: '@',
      // Paths never contain spaces; entity queries are also single-token.
      allowSpaces: false,
      // `@` can appear mid-sentence; the picker fires from any position.
      startOfLine: false,
      // Async because a drill-down fetches that reference's file list on
      // demand. Tiptap awaits this and only re-runs it when the query
      // actually changes, so the fetch happens once per drill-down rather
      // than per render.
      items: async ({ query }: { query: string }) => {
        const references = getReferences()
        const drillDown = parseReferenceDrillDown(query, references)
        let referenceFiles: FileMentionItem[] | null = null
        if (drillDown && drillDown.reference.exists && loadReferenceTree) {
          try {
            const entries = await loadReferenceTree(drillDown.reference.id)
            referenceFiles = toReferenceFileItems(drillDown.reference, entries)
          } catch {
            // A failed tree fetch degrades to worktree-only matches rather
            // than emptying the picker mid-keystroke.
            referenceFiles = null
          }
        }
        return buildItems({
          files: getFiles(),
          tasks: getTasks(),
          notes: getNotes(),
          references,
          referenceFiles,
          prs: getPrs(),
          drillDown,
          query,
        })
      },
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
        if (item.kind === 'reference') {
          // Not a chip — retarget the picker into the folder. Rewriting the
          // text to `@alias/` leaves the suggestion active, so `items` reruns
          // with a query that `parseReferenceDrillDown` recognizes. Typing
          // `@alias/` by hand lands in exactly the same place.
          chain.insertContent(`@${item.alias}/`).run()
        } else if (item.kind === 'file' || item.kind === 'dir') {
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
        } else if (item.kind === 'pr') {
          // Drop the picker discriminator; the rest is exactly PrChipAttrs,
          // so the chip is self-describing and serializes without re-reading
          // the PR cache at send time.
          const { kind: _kind, ...pr } = item
          chain.insertPrChip(pr).insertContent(' ').run()
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
