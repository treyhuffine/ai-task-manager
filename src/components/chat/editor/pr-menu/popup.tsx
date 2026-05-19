'use client'

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useImperativeHandle,
  forwardRef,
} from 'react'
import { GitPullRequest, GitMerge, GitPullRequestClosed } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SuggestionPopupRef } from '../suggestion/renderer'
import type { PrMentionItem } from './types'

interface PrMenuListProps {
  items: PrMentionItem[]
  command: (item: PrMentionItem) => void
}

function stateIcon(item: PrMentionItem) {
  if (item.state === 'MERGED') {
    return <GitMerge size={11} className="text-violet-500 dark:text-violet-400" />
  }
  if (item.state === 'CLOSED') {
    return (
      <GitPullRequestClosed size={11} className="text-rose-500 dark:text-rose-400" />
    )
  }
  return (
    <GitPullRequest
      size={11}
      className={cn(
        item.isDraft ? 'text-muted-foreground/70' : 'text-emerald-500 dark:text-emerald-400',
      )}
    />
  )
}

/**
 * `#`-mention popup. Matches Conductor's PR list shape: one row per PR
 * with state icon, `#<number>`, title, then a dimmer branch chip at
 * the end. Sorted newest-first by the route so the most recent PR is
 * pre-selected when the popup opens with no query.
 */
export const PrMenuList = forwardRef<SuggestionPopupRef, PrMenuListProps>(
  function PrMenuList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const listRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    useEffect(() => {
      const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
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
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length)
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          selectItem(selectedIndex)
          return true
        }
        if (event.key === 'Escape') {
          return true
        }
        return false
      },
    }))

    if (items.length === 0) {
      return (
        <div className="slash-command-menu px-3 py-2 text-xs text-muted-foreground">
          No matching PRs
        </div>
      )
    }

    return (
      <div ref={listRef} className="slash-command-menu chat-slash-menu">
        {items.map((item, index) => (
          <button
            key={item.number}
            type="button"
            className={`flex items-center gap-2 w-full px-2.5 py-1 rounded text-left transition-colors ${
              index === selectedIndex ? 'bg-accent' : 'hover:bg-accent/50'
            }`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="shrink-0 flex items-center justify-center w-3.5">
              {stateIcon(item)}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground shrink-0">
              #{item.number}
            </span>
            <span className="text-[11px] text-foreground truncate min-w-0">
              {item.title}
            </span>
            <span className="ml-auto pl-2 font-mono text-[10px] text-muted-foreground/70 truncate max-w-[40%]">
              {item.headRefName}
            </span>
          </button>
        ))}
      </div>
    )
  },
)
