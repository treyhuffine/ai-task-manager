'use client'

import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, {
  findSuggestionMatch,
  type SuggestionOptions,
  type SuggestionProps,
} from '@tiptap/suggestion'
import { createSuggestionPopupRenderer, type SuggestionRenderProps } from '../suggestion/renderer'
import { MentionMenuList } from './popup'
import {
  buildItems,
  canBrowseReference,
  entitySearchFor,
  filterQueryText,
  kindSuggestions,
  parseMentionQuery,
  parseReferenceDrillDown,
  toReferenceMention,
  queryAllowsSpaces,
  toReferenceFileItems,
} from './ranking'
import type {
  AppMentionResults,
  MentionItem,
  AgentMentionItem,
  FileMentionItem,
  MentionEntityResults,
  ReferenceFolderMentionItem,
  SearchAppMentions,
  SearchMentionEntities,
  SearchMentionSources,
} from './types'
import { appMentionItems, shouldSearchAppMentions } from './app-mentions'
import type { SourceSearchResult } from '@/lib/chat-sources/types'
import type { IssueMentionItem, PrMentionItem } from '../github-refs/types'
import { createReferenceMentionPlugin } from './reference-mention'

// Distinct PluginKey so this Suggestion plugin doesn't collide with the
// slash menu — Tiptap's `Suggestion` defaults to a shared
// `suggestion$` key, which ProseMirror rejects when more than one
// instance lives in the same editor.
const MENTION_MENU_PLUGIN_KEY = new PluginKey('mentionMenuSuggestion')

const CACHE_TTL_MS = 15_000
const CACHE_MAX_ENTRIES = 50

class TtlCache<V> {
  private map = new Map<string, { at: number; value: V }>()

  get(key: string): V | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.at >= CACHE_TTL_MS) {
      this.map.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: V): void {
    this.map.delete(key)
    this.map.set(key, { at: Date.now(), value })
    while (this.map.size > CACHE_MAX_ENTRIES) {
      this.map.delete(this.map.keys().next().value!)
    }
  }
}

interface MentionMenuOptions {
  searchSources?: SearchMentionSources
  /**
   * Items from connected apps that answer @ search (OpenAI's composer
   * at-mentions), such as one part from a parts library. Expected to
   * debounce and cache, since `items` runs on every keystroke.
   */
  searchAppMentions?: SearchAppMentions
  getScopeKey?: () => string | undefined
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
   * Agents this chat can mention, in the rail's order. Omitted (team chats,
   * which have no coordination): no agents.
   */
  getAgents?: () => AgentMentionItem[]
  /**
   * Reference folders visible from this session's workspace
   * (docs/reference-folders-spec.md §8). Linked folders outside the
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
  /** GitHub issues, listed with the pull requests under `@#`. Same contract as `getPrs`. */
  getIssues?: () => IssueMentionItem[]
}

/**
 * Tiptap extension that opens an `@`-picker covering files / tasks / notes /
 * agents / scratchpad / reference folders / issues and pull requests. One
 * trigger, eight kinds — the popup renders results in sections so visual
 * scanning stays fast. Ranking lives in `./ranking`, which is deliberately free of Tiptap so
 * it can be tested alone.
 *
 * Selecting a file inserts a `MentionChipNode` (the existing chip —
 * serialized to `@<path>` on send). Selecting an agent / task / note /
 * scratchpad inserts an `EntityChipNode` (serialized to `[[agent:id]]` /
 * `[[task:id]]` / `[[note:id]]` / `[[scratchpad]]`). Selecting a PR or an issue inserts a `PrChipNode` /
 * `IssueChipNode` (serialized to a full context line via `formatPrRef` /
 * `formatIssueRef`). Selecting a reference folder
 * inserts a folder chip and closes the picker. Typing `/` just after that chip
 * restores `@<alias>/` to optionally search its files.
 *
 * Issues and PRs are gated behind a `#` after the `@` (`@#193`) — see `github-trigger.ts`.
 * This replaced a standalone `#` trigger whose send-time raw-text expansion
 * surprised users by rewriting numbers they meant literally. `task:`,
 * `note:`, `agent:`, `app:`, `connector:` and `file:` narrow the same way
 * (`parseMentionQuery`), and all but `file:` take spaces, since titles and
 * names have them. The kind chips above the list and the kind suggestions
 * (`@ta` offers Tasks) only write those prefixes into the query.
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
      getAgents: undefined,
      getReferenceFolders: undefined,
      loadReferenceTree: undefined,
      getPrs: undefined,
      getIssues: undefined,
    }
  },

  addProseMirrorPlugins() {
    let accountGroup: { id: string; prefix: string } | null = null
    let pending: AbortController | null = null
    let activeProps: SuggestionProps<MentionItem> | null = null
    let activeLoading = false
    const refTreeCache = new TtlCache<FileMentionItem[]>()
    const entityCache = new TtlCache<MentionEntityResults>()
    const sourceCache = new TtlCache<SourceSearchResult>()
    const appMentionCache = new TtlCache<AppMentionResults>()

    const getFiles = () => this.options.getFileEntries?.() ?? []
    const searchEntities = this.options.searchEntities
    const getAgents = () => this.options.getAgents?.() ?? []
    const getReferences = () => this.options.getReferenceFolders?.() ?? []
    const getPrs = () => this.options.getPrs?.() ?? []
    const getIssues = () => this.options.getIssues?.() ?? []
    const loadReferenceTree = this.options.loadReferenceTree
    const renderPopup = createSuggestionPopupRenderer<MentionItem>(MentionMenuList)
    let popupRenderer: ReturnType<typeof renderPopup> | null = null

    const isCurrent = (props: SuggestionProps<MentionItem>) => {
      const current = MENTION_MENU_PLUGIN_KEY.getState(props.editor.state)
      return current?.active && current.query === props.query
        && current.range.from === props.range.from && current.range.to === props.range.to
    }

    const compose = (query: string, scope: string | undefined) => {
      const parsed = parseMentionQuery(query)
      if (accountGroup && !parsed.text.startsWith(accountGroup.prefix)) accountGroup = null
      const references = getReferences()
      const drillDown = parsed.filter ? null : parseReferenceDrillDown(query, references)
      const search = entitySearchFor(parsed, drillDown !== null)
      const appText = accountGroup ? '' : parsed.text
      const scopeKey = scope ?? ''

      const refKey = drillDown && canBrowseReference(drillDown.reference) && loadReferenceTree
        ? `${scopeKey}::${drillDown.reference.id}`
        : null
      const entityKey = search && searchEntities
        ? `${scopeKey}::${search.kind ?? 'any'}::${search.limit}::${search.q.trim()}`
        : null
      const sourceQuery = accountGroup ? parsed.text.slice(accountGroup.prefix.length).trim() : parsed.text
      const sourceKey = !drillDown && (!parsed.filter || parsed.filter === 'app' || parsed.filter === 'connector') && this.options.searchSources
        ? `${scopeKey}::${parsed.filter ?? 'all'}::${accountGroup?.id ?? ''}::${sourceQuery}`
        : null
      const appKey = this.options.searchAppMentions && shouldSearchAppMentions(parsed.filter, appText, !!drillDown || !!accountGroup)
        ? `${scopeKey}::${appText}`
        : null

      const cachedRefEntries = refKey ? refTreeCache.get(refKey) : undefined
      const referenceFiles = drillDown && cachedRefEntries
        ? toReferenceFileItems(drillDown.reference, cachedRefEntries)
        : null
      const entities = entityKey ? (entityCache.get(entityKey) ?? null) : null
      const sources = sourceKey ? (sourceCache.get(sourceKey) ?? null) : null
      const appMentions = appKey ? (appMentionCache.get(appKey) ?? null) : null

      const sourceItems: MentionItem[] = sources ? [...sources.items] : []
      if (sources && sources.total > sources.items.length) {
        sourceItems.push({ kind: 'more', of: 'app', total: sources.total, shown: sources.items.length, query: parsed.text, narrowed: !!parsed.filter })
      }
      const items = [
        ...kindSuggestions(query),
        ...sourceItems,
        ...appMentionItems(appMentions, parsed.filter === 'app'),
        ...buildItems({
          files: getFiles(),
          agents: getAgents(),
          entities,
          references,
          referenceFiles,
          prs: getPrs(),
          issues: getIssues(),
          drillDown,
          query,
        }),
      ]
      return {
        items,
        parsed,
        drillDown,
        search,
        appText,
        sourceQuery,
        refKey,
        entityKey,
        sourceKey,
        appKey,
        needsRefTree: refKey !== null && cachedRefEntries === undefined,
        needsEntities: entityKey !== null && entities === null,
        needsSources: sourceKey !== null && sources === null,
        needsAppMentions: appKey !== null && appMentions === null,
      }
    }

    const suggestion: Partial<SuggestionOptions<MentionItem, MentionItem>> = {
      pluginKey: MENTION_MENU_PLUGIN_KEY,
      char: '@',
      // Paths never contain spaces, so a query ends at one, except after
      // `task:`, `note:` or `agent:`, where titles and names do.
      allowSpaces: false,
      findSuggestionMatch: (config) => {
        const spaced = findSuggestionMatch({ ...config, allowSpaces: true })
        if (spaced && queryAllowsSpaces(spaced.query)) return spaced
        return findSuggestionMatch(config)
      },
      // `@` can appear mid-sentence; the picker fires from any position.
      startOfLine: false,
      // Synchronous: return local + cached items immediately so the popup opens
      // with a loading skeleton instead of freezing on slow server/MCP calls.
      items: ({ query }: { query: string }) => {
        pending?.abort()
        const request = new AbortController()
        pending = request
        const scope = this.options.getScopeKey?.()
        const state = compose(query, scope)
        let inFlight =
          (state.needsRefTree ? 1 : 0) +
          (state.needsEntities ? 1 : 0) +
          (state.needsSources ? 1 : 0) +
          (state.needsAppMentions ? 1 : 0)
        activeLoading = inFlight > 0

        const finishOne = () => {
          inFlight = Math.max(0, inFlight - 1)
          if (request.signal.aborted || scope !== this.options.getScopeKey?.()) return
          if (!activeProps || activeProps.query !== query || !isCurrent(activeProps)) return
          const next = compose(query, scope)
          activeLoading = inFlight > 0
          popupRenderer?.onUpdate?.({
            ...activeProps,
            items: next.items,
            loading: activeLoading,
          } as SuggestionRenderProps<MentionItem>)
        }

        if (state.needsRefTree && state.drillDown && loadReferenceTree && state.refKey) {
          const refKey = state.refKey
          void loadReferenceTree(state.drillDown.reference.id)
            .then((entries) => {
              if (!request.signal.aborted && scope === this.options.getScopeKey?.()) refTreeCache.set(refKey, entries)
            })
            .catch(() => null)
            .finally(finishOne)
        }
        if (state.needsEntities && state.search && searchEntities && state.entityKey) {
          const entityKey = state.entityKey
          void searchEntities(state.search)
            .then((result) => {
              if (!request.signal.aborted && scope === this.options.getScopeKey?.()) entityCache.set(entityKey, result)
            })
            .catch(() => null)
            .finally(finishOne)
        }
        if (state.needsSources && this.options.searchSources && state.sourceKey) {
          const sourceKey = state.sourceKey
          const sourceFilter = state.parsed.filter === 'app' || state.parsed.filter === 'connector' ? state.parsed.filter : undefined
          void this.options.searchSources(state.sourceQuery, sourceFilter, accountGroup?.id, request.signal)
            .then((result) => {
              if (!request.signal.aborted && scope === this.options.getScopeKey?.()) sourceCache.set(sourceKey, result)
            })
            .catch(() => null)
            .finally(finishOne)
        }
        if (state.needsAppMentions && this.options.searchAppMentions && state.appKey) {
          const appKey = state.appKey
          void this.options.searchAppMentions(state.appText, request.signal)
            .then((result) => {
              if (!request.signal.aborted && scope === this.options.getScopeKey?.() && result) appMentionCache.set(appKey, result)
            })
            .catch(() => null)
            .finally(finishOne)
        }

        return state.items
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
        if (item.kind === 'source') {
          chain.insertSourceChip({ sourceRef: item.source.sourceRef }).insertContent(' ').run()
        } else if (item.kind === 'appMention') {
          // The same chip as an account mention, carrying the item as well.
          chain.insertSourceChip({ sourceRef: item.sourceRef }).insertContent(' ').run()
        } else if (item.kind === 'sourceGroup') {
          accountGroup = { id: item.groupId, prefix: `${item.label} /` }
          chain.insertContent(`@app:${accountGroup.prefix}`).run()
        } else if (item.kind === 'reference') {
          // Keep the caret immediately after the completed mention so `/`
          // can refine it. A normal space continues the message.
          chain.insertMentionChip(toReferenceMention(item)).run()
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
        } else if (item.kind === 'agent') {
          chain
            .insertEntityChip({ kind: 'agent', id: item.id, title: item.name })
            .insertContent(' ')
            .run()
        } else if (item.kind === 'more') {
          // Narrow to that kind, keeping the search. The suggestion stays
          // active on the new text, as with a reference folder.
          if (!item.narrowed) chain.insertContent(filterQueryText(item.of, item.query)).run()
        } else if (item.kind === 'filter') {
          // A kind chip or suggestion: the query is rewritten, never a chip
          // inserted, so the text stays the one record of the filter.
          chain.insertContent(filterQueryText(item.filter, item.query)).run()
        } else if (item.kind === 'pr') {
          // Drop the picker discriminator; the rest is exactly PrChipAttrs,
          // so the chip is self-describing and serializes without re-reading
          // the PR cache at send time.
          const { kind: _kind, ...pr } = item
          chain.insertPrChip(pr).insertContent(' ').run()
        } else if (item.kind === 'issue') {
          const { kind: _kind, ...issue } = item
          chain.insertIssueChip(issue).insertContent(' ').run()
        }
      },
      render: () => {
        const renderer = renderPopup()
        popupRenderer = renderer
        return {
          ...renderer,
          onStart: (props: SuggestionProps<MentionItem>) => {
            if (!isCurrent(props)) return
            activeProps = props
            renderer.onStart({ ...props, loading: activeLoading })
          },
          onUpdate: (props: SuggestionProps<MentionItem>) => {
            if (!isCurrent(props)) return
            activeProps = props
            renderer.onUpdate({ ...props, loading: activeLoading })
          },
          onExit: () => {
            activeProps = null
            activeLoading = false
            pending?.abort()
            pending = null
            renderer.onExit()
          },
        }
      },
    }

    return [
      createReferenceMentionPlugin(getReferences, () => this.editor.view.composing),
      Suggestion<MentionItem, MentionItem>({
        editor: this.editor,
        ...suggestion,
      }),
    ]
  },
})
