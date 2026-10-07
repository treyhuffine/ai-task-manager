'use client'

import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, {
  findSuggestionMatch,
  type SuggestionOptions,
  type SuggestionProps,
} from '@tiptap/suggestion'
import { createSuggestionPopupRenderer, settledItems } from '../suggestion/renderer'
import { MentionMenuList } from './popup'
import {
  buildItems,
  canBrowseReference,
  entitySearchFor,
  narrowedQueryText,
  parseMentionQuery,
  parseReferenceDrillDown,
  pickReference,
  queryAllowsSpaces,
  toReferenceFileItems,
} from './ranking'
import type {
  MentionItem,
  FileMentionItem,
  MentionEntityResults,
  ReferenceFolderMentionItem,
  SearchMentionEntities,
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
  /**
   * Searches tasks and notes across the home for one query (the server
   * ranks this chat's and this agent's first). Expected to cache, since
   * `items` runs on every keystroke. Omitted: no tasks or notes.
   */
  searchEntities?: SearchMentionEntities
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
 * surprised users by rewriting numbers they meant literally. `task:`,
 * `note:` and `file:` narrow the same way (`parseMentionQuery`), and the
 * task and note filters take spaces, since titles have them.
 */
export const MentionMenuExtension = Extension.create<MentionMenuOptions>({
  name: 'mentionMenu',

  // Same priority as the slash menu so Enter on an open suggestion
  // selects an item rather than submitting the partial message.
  priority: 200,

  addOptions() {
    return {
      getFileEntries: undefined,
      searchEntities: undefined,
      getReferenceFolders: undefined,
      loadReferenceTree: undefined,
      getPrs: undefined,
    }
  },

  addProseMirrorPlugins() {
    const getFiles = () => this.options.getFileEntries?.() ?? []
    const searchEntities = this.options.searchEntities
    const getReferences = () => this.options.getReferenceFolders?.() ?? []
    const getPrs = () => this.options.getPrs?.() ?? []
    const loadReferenceTree = this.options.loadReferenceTree

    const suggestion: Partial<SuggestionOptions<MentionItem, MentionItem>> = {
      pluginKey: MENTION_MENU_PLUGIN_KEY,
      char: '@',
      // Paths never contain spaces, so a query ends at one, except after
      // `task:` or `note:`, where titles do.
      allowSpaces: false,
      findSuggestionMatch: (config) => {
        const spaced = findSuggestionMatch({ ...config, allowSpaces: true })
        if (spaced && queryAllowsSpaces(spaced.query)) return spaced
        return findSuggestionMatch(config)
      },
      // `@` can appear mid-sentence; the picker fires from any position.
      startOfLine: false,
      // Async: tasks and notes are a server search, and a drill-down
      // fetches that reference's file list on demand. Tiptap awaits this and
      // only re-runs it when the query actually changes. The renderer keeps
      // the last list up until this one lands (`asyncItems`).
      items: async ({ query }: { query: string }) => {
        const parsed = parseMentionQuery(query)
        const references = getReferences()
        const drillDown = parsed.filter ? null : parseReferenceDrillDown(query, references)
        const search = entitySearchFor(parsed, drillDown !== null)
        const [referenceFiles, entities] = await Promise.all([
          drillDown && canBrowseReference(drillDown.reference) && loadReferenceTree
            ? loadReferenceTree(drillDown.reference.id)
                .then((entries) => toReferenceFileItems(drillDown.reference, entries))
                // A failed tree fetch degrades to worktree-only matches rather
                // than emptying the picker mid-keystroke.
                .catch(() => null)
            : null,
          // Same for a failed search: files and the rest still show.
          search && searchEntities
            ? searchEntities(search).catch((): MentionEntityResults | null => null)
            : null,
        ])
        return settledItems(buildItems({
          files: getFiles(),
          entities,
          references,
          referenceFiles,
          prs: getPrs(),
          drillDown,
          query,
        }))
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
          // Usually not a chip: retarget the picker into the folder. Rewriting
          // the text to `@alias/` leaves the suggestion active, so `items`
          // reruns with a query that `parseReferenceDrillDown` recognizes.
          // Typing `@alias/` by hand lands in exactly the same place. A folder
          // whose files are on another device is mentioned instead.
          const pick = pickReference(item)
          if (pick.kind === 'chip') chain.insertMentionChip(pick.chip).insertContent(' ').run()
          else chain.insertContent(pick.text).run()
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
        } else if (item.kind === 'more') {
          // Narrow to that kind, keeping the search. The suggestion stays
          // active on the new text, as with a reference folder.
          if (!item.narrowed) chain.insertContent(narrowedQueryText(item.of, item.query)).run()
        } else if (item.kind === 'pr') {
          // Drop the picker discriminator; the rest is exactly PrChipAttrs,
          // so the chip is self-describing and serializes without re-reading
          // the PR cache at send time.
          const { kind: _kind, ...pr } = item
          chain.insertPrChip(pr).insertContent(' ').run()
        }
      },
      render: createSuggestionPopupRenderer<MentionItem>(MentionMenuList, { asyncItems: true }),
    }

    return [
      Suggestion<MentionItem, MentionItem>({
        editor: this.editor,
        ...suggestion,
      }),
    ]
  },
})
