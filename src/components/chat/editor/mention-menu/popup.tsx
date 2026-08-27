'use client'

import {
  useState,
  useEffect,
  useCallback,
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
} from 'lucide-react'
import { FileIcon } from '@/components/file-icon'
import type { SuggestionPopupRef } from '../suggestion/renderer'
import { isSuggestionCommitKey, suggestionNavDelta } from '../suggestion/keys'
import type { MentionItem } from './types'

interface MentionMenuListProps {
  items: MentionItem[]
  command: (item: MentionItem) => void
}

type Section = 'entity' | 'task' | 'note' | 'reference' | 'file' | 'pr' | `ref:${string}`

function sectionFor(item: MentionItem): Section {
  if (item.kind === 'scratchpad') return 'entity'
  if (item.kind === 'task') return 'task'
  if (item.kind === 'note') return 'note'
  if (item.kind === 'reference') return 'reference'
  if (item.kind === 'pr') return 'pr'
  // Files pulled out of a reference folder band under that folder's alias, so
  // a drill-down visibly separates "inside @backend" from worktree matches.
  if (item.referenceAlias) return `ref:${item.referenceAlias}`
  return 'file'
}

function keyFor(item: MentionItem): string {
  switch (item.kind) {
    case 'scratchpad':
      return 'scratchpad'
    case 'task':
      return `task:${item.id}`
    case 'note':
      return `note:${item.id}`
    case 'reference':
      return `reference:${item.id}`
    case 'pr':
      return `pr:${item.number}`
    default:
      return `file:${item.path}`
  }
}

/**
 * `@`-picker popup. One vertical list — but rows are visually banded
 * into sections (Scratchpad / Tasks / Notes / Files) using inline
 * dividers so a glance tells you what kind of result you're hovering.
 *
 * Single index drives both arrow navigation and selection — section
 * headers are non-interactive labels in between, not their own focus
 * targets.
 */
export const MentionMenuList = forwardRef<SuggestionPopupRef, MentionMenuListProps>(
  function MentionMenuList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const listRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    useEffect(() => {
      const el = listRef.current?.querySelector(`[data-mention-index="${selectedIndex}"]`) as
        | HTMLElement
        | undefined
      el?.scrollIntoView({ block: 'nearest' })
    }, [selectedIndex])

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index]
        if (item) command(item)
      },
      [items, command],
    )

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
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

    if (items.length === 0) {
      return (
        <div className="slash-command-menu px-3 py-2 text-xs text-muted-foreground">
          No matches
        </div>
      )
    }

    // Walk the (already-ordered) item list and inject a divider before
    // each new section's first row. The ordering convention from
    // buildItems() is: scratchpad → tasks → notes → reference folders →
    // files, or (inside a drill-down) that reference's files → worktree files.
    const rows: React.ReactNode[] = []
    let prevSection: Section | null = null
    items.forEach((item, index) => {
      const section = sectionFor(item)
      if (section !== prevSection) {
        rows.push(
          <SectionHeader key={`hdr-${section}-${index}`} kind={section} />,
        )
        prevSection = section
      }
      rows.push(
        <MentionRow
          key={keyFor(item)}
          item={item}
          index={index}
          selected={index === selectedIndex}
          onSelect={selectItem}
          onHover={setSelectedIndex}
        />,
      )
    })

    return (
      <div ref={listRef} className="slash-command-menu chat-slash-menu">
        {rows}
      </div>
    )
  },
)

function SectionHeader({ kind }: { kind: Section }) {
  let label: string
  if (kind === 'entity') label = 'This session'
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
      type="button"
      className={`flex items-center gap-2 w-full px-2.5 py-1 rounded text-left transition-colors ${
        selected ? 'bg-accent' : 'hover:bg-accent/50'
      }`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onSelect(index)}
      onMouseEnter={() => onHover(index)}
    >
      <span className="shrink-0 flex items-center justify-center w-3.5">
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
  if (item.kind === 'scratchpad') {
    return <Notebook size={11} className="text-muted-foreground/80" />
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
  if (item.kind === 'task' || item.kind === 'note') {
    return (
      <span className="text-[11px] text-foreground truncate min-w-0">
        {item.title || (item.kind === 'task' ? 'Untitled task' : 'Untitled note')}
      </span>
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
