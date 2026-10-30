'use client';
import { SOURCE_STATUS_LABELS } from '@/lib/chat-sources/types'

import { cn } from '@/lib/utils'
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useImperativeHandle,
  forwardRef,
} from 'react'
import {
  Folder,
  FolderSymlink,
  Square,
  CheckSquare,
  StickyNote,
  Notebook,
  AlertTriangle,
  GitPullRequest,
  GitPullRequestDraft,
  GitPullRequestClosed,
  GitMerge,
  ListFilter,
  FileText,
} from 'lucide-react'
import { FileIcon } from '@/components/file-icon'
import { SourceMark } from '@/components/chat-ui/references/source-mark'
import { McpIconImage } from '@/components/mcp-apps/mcp-icon'
import { AgentPicture } from '@/components/agents/agent-icon'
import { Kbd } from '@/components/ui/kbd'
import { HOTKEYS } from '@/constants/commands'
import type { SuggestionPopupRef } from '../suggestion/renderer'
import { isSuggestionCommitKey, suggestionKindDelta, suggestionNavDelta } from '../suggestion/keys'
import { MENTION_KINDS, mentionKind, parseMentionQuery } from './ranking'
import type { MentionFilter, MentionItem, MoreMentionItem } from './types'

interface MentionMenuListProps {
  items: MentionItem[]
  command: (item: MentionItem) => void
  query?: string
}

/** In a list narrowed to one kind, "how many more" is a caption, not a row. */
function isCaption(item: MentionItem): item is MoreMentionItem {
  return item.kind === 'more' && item.narrowed
}

const KIND_NOUNS = { task: 'tasks', note: 'notes', agent: 'agents', file: 'files', pr: 'pull requests', app: 'apps', connector: 'connectors' } as const

/** The chips above the list: every kind, then each one alone. */
const KIND_CHIPS: readonly (MentionFilter | null)[] = [null, ...MENTION_KINDS.map((kind) => kind.filter)]

type Section = 'filter' | 'app' | 'entity' | 'agent' | 'task' | 'note' | 'reference' | 'file' | 'pr' | `ref:${string}` | `mention:${string}`

function sectionFor(item: MentionItem): Section {
  // A kind suggestion leads the list on its own, with no header.
  if (item.kind === 'filter') return 'filter'
  if (item.kind === 'source' || item.kind === 'sourceGroup') return 'app'
  // One band per app whose @ search answered, headed by the app's name.
  if (item.kind === 'appMention') return `mention:${item.serverId}`
  if (item.kind === 'scratchpad') return 'entity'
  if (item.kind === 'agent') return 'agent'
  if (item.kind === 'task') return 'task'
  if (item.kind === 'note') return 'note'
  if (item.kind === 'more') return item.of
  if (item.kind === 'reference') return 'reference'
  if (item.kind === 'pr') return 'pr'
  // Files pulled out of a reference folder band under that folder's alias, so
  // a drill-down visibly separates "inside @backend" from worktree matches.
  if (item.referenceAlias) return `ref:${item.referenceAlias}`
  return 'file'
}

function keyFor(item: MentionItem): string {
  switch (item.kind) {
    case 'source': return item.source.sourceRef
    case 'appMention': return `appMention:${item.sourceRef}`
    case 'sourceGroup': return `sourceGroup:${item.groupId}`
    case 'scratchpad':
      return 'scratchpad'
    case 'agent':
      return `agent:${item.id}`
    case 'task':
      return `task:${item.id}`
    case 'note':
      return `note:${item.id}`
    case 'reference':
      return `reference:${item.id}`
    case 'pr':
      return `pr:${item.number}`
    case 'more':
      return `more:${item.of}`
    case 'filter':
      return `filter:${item.filter ?? 'all'}`
    default:
      return `file:${item.path}`
  }
}

/**
 * `@`-picker popup. One vertical list — but rows are visually banded
 * into sections (Scratchpad / Tasks / Notes / Agents / Files) using inline
 * dividers so a glance tells you what kind of result you're hovering.
 *
 * Single index drives both arrow navigation and selection — section
 * headers are non-interactive labels in between, not their own focus
 * targets. So is the caption under a capped narrowed list.
 *
 * Kind chips sit above the list (All, Tasks, Notes...), the current one
 * pressed. A chip writes its prefix into the query (`@task:`) rather than
 * holding a filter of its own, so the text, the chips and the results
 * always agree. While nothing is searched yet, ← and → move between the
 * chips and Enter applies one. Up and down go back to the results.
 *
 * The mixed list ends with a line that teaches the typed filters (`task:`,
 * `note:`, `agent:`, `app:`, `connector:`, `file:`, `#`). A narrowed list
 * says what it is when it's empty.
 */
export const MentionMenuList = forwardRef<SuggestionPopupRef, MentionMenuListProps>(
  function MentionMenuList({ items: allItems, command, query = '' }, ref) {
    const [selection, setSelection] = useState<{ items: MentionItem[] | null; index: number }>({ items: null, index: 0 })
    const selectedIndex = selection.items === allItems ? selection.index : 0
    const setSelectedIndex = useCallback((next: number | ((previous: number) => number)) => {
      setSelection(previous => ({ items: allItems, index: typeof next === 'function' ? next(previous.items === allItems ? previous.index : 0) : next }))
    }, [allItems])
    // The chip the arrow keys are on, for this list only. Null: the
    // keyboard is in the results.
    const [chipFocus, setChipFocus] = useState<{ items: MentionItem[]; index: number } | null>(null)
    const focusedChip = chipFocus?.items === allItems ? chipFocus.index : null
    const listRef = useRef<HTMLDivElement>(null)
    const chipsRef = useRef<HTMLDivElement>(null)
    const items = useMemo(() => allItems.filter((item) => !isCaption(item)), [allItems])
    const caption = allItems.find(isCaption)
    const parsed = parseMentionQuery(query)
    const activeChip = KIND_CHIPS.indexOf(parsed.filter)
    // Inside a path (`@src/`, `@backend/`) the list is files, not kinds.
    const showChips = parsed.filter !== null || !query.includes('/')
    // The arrows move the caret through a search, so only an empty one
    // hands them to the chips.
    const arrowsPickKind = showChips && parsed.text === ''
    const shownChip = focusedChip ?? activeChip

    useEffect(() => {
      const el = listRef.current?.querySelector(`[data-mention-index="${selectedIndex}"]`) as
        | HTMLElement
        | undefined
      el?.scrollIntoView({ block: 'nearest' })
    }, [selectedIndex])

    // Keep the current or focused chip in view on a narrow composer. Only
    // the chip row scrolls, never the page around the popup.
    useEffect(() => {
      const row = chipsRef.current
      const chip = row?.querySelector<HTMLElement>(`[data-kind-index="${shownChip}"]`)
      if (!row || !chip) return
      if (chip.offsetLeft < row.scrollLeft) row.scrollLeft = chip.offsetLeft
      else if (chip.offsetLeft + chip.offsetWidth > row.scrollLeft + row.clientWidth) {
        row.scrollLeft = chip.offsetLeft + chip.offsetWidth - row.clientWidth
      }
    }, [shownChip])

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index]
        if (item) command(item)
      },
      [items, command],
    )

    const pickKind = useCallback(
      (filter: MentionFilter | null) => {
        setChipFocus(null)
        if (filter !== parsed.filter) command({ kind: 'filter', filter, query: parsed.text })
      },
      [command, parsed.filter, parsed.text],
    )

    const hoverRow = useCallback((index: number) => {
      setChipFocus(null)
      setSelectedIndex(index)
    }, [setSelectedIndex])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        const kindStep = arrowsPickKind ? suggestionKindDelta(event) : 0
        if (kindStep !== 0) {
          setChipFocus({ items: allItems, index: (shownChip + kindStep + KIND_CHIPS.length) % KIND_CHIPS.length })
          return true
        }
        if (focusedChip !== null) {
          if (isSuggestionCommitKey(event)) {
            pickKind(KIND_CHIPS[focusedChip])
            return true
          }
          // Up or down leaves the chips for the results, where it left them.
          if (suggestionNavDelta(event) !== 0) {
            setChipFocus(null)
            return true
          }
        }
        if (items.length === 0) return false
        const delta = suggestionNavDelta(event)
        if (delta !== 0) {
          setSelectedIndex((prev) => (prev + delta + items.length) % items.length)
          return true
        }
        if (isSuggestionCommitKey(event)) {
          selectItem(selectedIndex)
          return true
        }
        // Modified Enter (newline / send) belongs to the composer.
        return false
      },
    }))

    // Mixed list, outside a reference folder: say how to narrow it.
    const footer = parsed.filter === null && !query.includes('/') ? <FilterHint arrows={arrowsPickKind} /> : null
    const chips = showChips ? (
      <KindChips
        rowRef={chipsRef}
        active={activeChip}
        focused={focusedChip}
        onPick={(index) => pickKind(KIND_CHIPS[index])}
      />
    ) : null

    if (items.length === 0) {
      // `@task:` takes spaces, so prose typed after a search that found
      // nothing would drag an empty box along. Show nothing instead.
      if (parsed.filter && /\s/.test(parsed.text)) return null
      const search = parsed.text.trim()
      const noun = parsed.filter ? KIND_NOUNS[parsed.filter] : null
      return (
        <div className="slash-command-menu chat-slash-menu">
          {chips}
          <div className="px-2.5 py-1.5 text-xs text-muted-foreground">
            {noun
              ? search ? `No ${noun} match “${search}”` : `No ${noun} yet`
              : 'No matches'}
          </div>
          {footer}
        </div>
      )
    }

    // Walk the (already-ordered) item list and inject a divider before
    // each new section's first row. The ordering convention from
    // buildItems() is: scratchpad → tasks → notes → agents → reference
    // folders → files, or (inside a drill-down) that reference's files →
    // worktree files.
    const rows: React.ReactNode[] = []
    let prevSection: Section | null = null
    items.forEach((item, index) => {
      const section = sectionFor(item)
      if (section !== prevSection) {
        if (section !== 'filter') {
          rows.push(
            <SectionHeader key={`hdr-${section}-${index}`} kind={section} label={item.kind === 'appMention' ? item.group : undefined} />,
          )
        }
        prevSection = section
      }
      rows.push(
        <MentionRow
          key={keyFor(item)}
          item={item}
          index={index}
          selected={focusedChip === null && index === selectedIndex}
          onSelect={selectItem}
          onHover={hoverRow}
        />,
      )
    })

    // The menu's own overflow is turned off so the chips and the hint stay
    // put while the rows scroll between them.
    return (
      <div className="slash-command-menu chat-slash-menu" style={{ overflowY: 'hidden' }}>
        {chips}
        <div ref={listRef} className="flex min-h-0 flex-col gap-px overflow-y-auto">
          {rows}
          {caption && (
            <div className="px-2.5 pt-1 pb-0.5 text-[10.5px] text-muted-foreground/70">
              Showing {caption.shown} of {caption.total}. Type more to narrow.
            </div>
          )}
        </div>
        {footer}
      </div>
    )
  },
)

/**
 * One chip per kind, plus All. Buttons, not a tab list: the keyboard stays
 * in the editor, so the chip the arrows are on is drawn, not focused.
 */
function KindChips({
  rowRef,
  active,
  focused,
  onPick,
}: {
  rowRef: React.Ref<HTMLDivElement>
  active: number
  focused: number | null
  onPick: (index: number) => void
}) {
  return (
    <div
      ref={rowRef}
      role="toolbar"
      aria-label="Search one kind"
      className="relative mb-0.5 flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/60 px-0.5 pt-0.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {KIND_CHIPS.map((filter, index) => (
        <button
          key={filter ?? 'all'}
          type="button"
          data-kind-index={index}
          data-kind-chip={filter ?? 'all'}
          data-focused={index === focused ? '' : undefined}
          aria-pressed={index === active}
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-4 transition-colors',
            index === active
              ? 'bg-accent font-medium text-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            index === focused && 'ring-1 ring-inset ring-ring',
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(index)}
        >
          {filter ? mentionKind(filter).label : 'All'}
        </button>
      ))}
    </div>
  )
}

/** The filters, in the words you'd type them, and the keys for the chips. */
function FilterHint({ arrows }: { arrows: boolean }) {
  const code = (text: string) => (
    <code key={text} className="rounded bg-muted px-1 py-px font-mono text-[10px] text-foreground/80">{text}</code>
  )
  const prefixes = MENTION_KINDS.map((kind) => kind.prefix)
  return (
    <div className="mt-0.5 flex shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 border-t border-border/60 px-2.5 pt-1.5 pb-1 text-[10.5px] text-muted-foreground/70">
      Type {prefixes.slice(0, -1).map(code)} or {code(prefixes[prefixes.length - 1])} to search one kind
      {arrows && (
        <span className="ml-auto flex items-center gap-1 pl-2 pointer-coarse:hidden">
          <Kbd>{HOTKEYS.mentionKindPrevious.label}</Kbd>
          <Kbd>{HOTKEYS.mentionKindNext.label}</Kbd>
          to pick one
        </span>
      )}
    </div>
  )
}

function SectionHeader({ kind, label: named }: { kind: Section; label?: string }) {
  let label: string
  if (named) label = named
  else if (kind === 'entity') label = 'This session'
  else if (kind === 'app') label = 'Apps'
  else if (kind === 'agent') label = 'Agents'
  else if (kind === 'task') label = 'Tasks'
  else if (kind === 'note') label = 'Notes'
  else if (kind === 'reference') label = 'Reference folders'
  else if (kind === 'pr') label = 'Pull requests'
  else if (kind.startsWith('ref:')) label = `In @${kind.slice(4)} · read-only`
  else label = 'Files'
  return (
    <div className="px-2.5 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
      {label}
    </div>
  )
}

interface MentionRowProps {
  item: MentionItem
  index: number
  selected: boolean
  onSelect: (index: number) => void
  onHover: (index: number) => void
}

function MentionRow({ item, index, selected, onSelect, onHover }: MentionRowProps) {
  return (
    <button
      data-mention-index={index}
      data-selected={selected ? '' : undefined}
      type="button"
      className={`flex items-center gap-2 w-full px-2.5 py-1 rounded text-left transition-colors ${
        selected ? 'bg-accent' : 'hover:bg-accent/50'
      }`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onSelect(index)}
      onMouseEnter={() => onHover(index)}
    >
      <span className={cn('shrink-0 flex items-center justify-center', item.kind === 'agent' ? 'w-5' : 'w-3.5')}>
        <RowIcon item={item} />
      </span>
      <RowBody item={item} />
    </button>
  )
}

function PrRowIcon({ state, isDraft }: { state: string; isDraft: boolean }) {
  if (state === 'MERGED') {
    return <GitMerge size={11} className="text-violet-500 dark:text-violet-400" />
  }
  if (state === 'CLOSED') {
    return <GitPullRequestClosed size={11} className="text-rose-500 dark:text-rose-400" />
  }
  if (isDraft) {
    return <GitPullRequestDraft size={11} className="text-muted-foreground/80" />
  }
  return <GitPullRequest size={11} className="text-emerald-500 dark:text-emerald-400" />
}

function RowIcon({ item }: { item: MentionItem }) {
  if (item.kind === 'source') return <SourceMark mark={item.source.mark} name={item.source.service} size={13} />
  if (item.kind === 'sourceGroup') return <SourceMark mark={item.mark} name={item.label} size={13} />
  if (item.kind === 'appMention') {
    const generic = <FileText size={11} className="text-muted-foreground/80" />
    return <McpIconImage icons={item.icons} size={13} fallback={<McpIconImage icons={item.appIcons} size={13} fallback={generic} />} />
  }
  if (item.kind === 'more' || item.kind === 'filter') {
    return <ListFilter size={11} className="text-muted-foreground/80" />
  }
  if (item.kind === 'scratchpad') {
    return <Notebook size={11} className="text-muted-foreground/80" />
  }
  if (item.kind === 'agent') {
    // This popup has its own React root, so the picture comes resolved.
    return <AgentPicture picture={item.picture} name={item.name} size="sm" />
  }
  if (item.kind === 'pr') {
    return <PrRowIcon state={item.state} isDraft={item.isDraft} />
  }
  if (item.kind === 'reference') {
    if (!item.exists) return <AlertTriangle size={11} className="text-destructive/80" />
    return <FolderSymlink size={11} className="text-muted-foreground/80" />
  }
  if (item.kind === 'task') {
    if (item.status === 'done') {
      return <CheckSquare size={11} className="text-muted-foreground/80" />
    }
    return <Square size={11} className="text-muted-foreground/80" />
  }
  if (item.kind === 'note') {
    return <StickyNote size={11} className="text-muted-foreground/80" />
  }
  if (item.kind === 'dir') {
    return <Folder size={11} className="text-muted-foreground/80" />
  }
  return <FileIcon name={item.name} size={11} />
}

function RowBody({ item }: { item: MentionItem }) {
  if (item.kind === 'sourceGroup') return <><span className="truncate text-[11px] font-medium">{item.label}</span><span className="ml-auto text-[10px] text-muted-foreground">{item.count} accounts ›</span></>
  if (item.kind === 'appMention') {
    return (
      <>
        <span className="text-[11px] text-foreground shrink-0 max-w-[60%] truncate">{item.title}</span>
        {item.subtitle && <span className="text-[10.5px] text-muted-foreground/70 truncate min-w-0">{item.subtitle}</span>}
      </>
    )
  }
  if (item.kind === 'source') {
    const capabilities = [item.source.chat && 'Chat', item.source.view === 'available' && 'View'].filter(Boolean).join(' + ')
    // The service leads, as it reads on the chip. The account says which one, unless it only repeats the name.
    const account = item.source.accountLabel && item.source.accountLabel.toLocaleLowerCase() !== item.source.service.toLocaleLowerCase() ? item.source.accountLabel : null
    return <>
      <span className="min-w-0 truncate text-[11px]">
        <span className="font-medium">{item.source.service}</span>
        {account && <span className="text-muted-foreground"> · {account}</span>}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {capabilities && <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{capabilities}</span>}
        {item.source.status !== 'ready' && <span className="text-[9px] text-muted-foreground">{SOURCE_STATUS_LABELS[item.source.status]}</span>}
      </span>
    </>
  }

  if (item.kind === 'filter') {
    return (
      <>
        <span className="text-[11px] text-foreground truncate min-w-0">
          Search {item.filter ? KIND_NOUNS[item.filter] : 'everything'}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
          {item.filter ? mentionKind(item.filter).prefix : ''}
        </span>
      </>
    )
  }
  if (item.kind === 'more') {
    const noun = KIND_NOUNS[item.of]
    return (
      <>
        <span className="text-[11px] text-muted-foreground truncate min-w-0">
          {item.query ? `All ${item.total} ${noun} matching “${item.query}”` : `All ${item.total} ${noun}`}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/60">{item.of}:</span>
      </>
    )
  }
  if (item.kind === 'scratchpad') {
    return (
      <>
        <span className="text-[11px] text-foreground font-medium shrink-0">Scratchpad</span>
        <span className="text-[10.5px] text-muted-foreground/70 truncate min-w-0">
          for this session
        </span>
      </>
    )
  }
  if (item.kind === 'agent') {
    return (
      <>
        <span className="text-[11px] text-foreground font-medium shrink-0 max-w-[60%] truncate">{item.name}</span>
        {item.purpose && (
          <span className="text-[10.5px] text-muted-foreground/70 truncate min-w-0">{item.purpose}</span>
        )}
      </>
    )
  }
  if (item.kind === 'task' || item.kind === 'note') {
    const tag =
      item.kind === 'task' && item.status === 'consider'
        ? 'Consider'
        : item.kind === 'task' && item.status === 'in_progress'
          ? 'In progress'
          : null
    return (
      <>
        <span className="text-[11px] text-foreground truncate min-w-0">
          {item.title || (item.kind === 'task' ? 'Untitled task' : 'Untitled note')}
        </span>
        {tag && (
          <span
            className={cn(
              'ml-auto shrink-0 rounded px-1 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide',
              tag === 'Consider' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
            )}
          >
            {tag}
          </span>
        )}
      </>
    )
  }
  if (item.kind === 'pr') {
    return (
      <>
        <span className="font-mono text-[11px] text-muted-foreground shrink-0">
          #{item.number}
        </span>
        <span className="text-[11px] text-foreground truncate min-w-0">{item.title}</span>
        <span className="ml-auto pl-2 font-mono text-[10px] text-muted-foreground/70 truncate max-w-[40%]">
          {item.headRefName}
        </span>
      </>
    )
  }
  if (item.kind === 'reference') {
    return (
      <>
        <span className="font-mono text-[11px] text-foreground shrink-0">@{item.alias}</span>
        <span className="text-[10.5px] text-muted-foreground/70 truncate min-w-0">
          {item.exists ? item.absolutePath : 'folder is missing'}
        </span>
      </>
    )
  }
  // Inside a reference the label already carries `alias/relative/path`, so the
  // parent shown is that rather than a bare worktree-relative directory.
  const display = item.label ?? item.path
  const slash = display.lastIndexOf('/')
  const parent = slash === -1 ? '' : display.slice(0, slash)
  return (
    <>
      <span className="font-mono text-[11px] text-foreground shrink-0">{item.name}</span>
      {parent && (
        <span className="text-[11px] text-muted-foreground/70 truncate min-w-0">
          {parent}
        </span>
      )}
    </>
  )
}
