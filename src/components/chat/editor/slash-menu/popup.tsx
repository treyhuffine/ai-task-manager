'use client'

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useImperativeHandle,
  forwardRef,
} from 'react'
import type { SuggestionKeyDownProps } from '@tiptap/suggestion'
import type { SkillCommandDescriptor } from './types'

export interface SlashMenuListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

interface SlashMenuListProps {
  items: SkillCommandDescriptor[]
  command: (item: SkillCommandDescriptor) => void
}

/**
 * Dense two-column row layout: command name in mono on the left at a
 * fixed-ish column width, description on the right filling the rest.
 * Matches Conductor's slash menu shape — text-only (no icons), tight
 * padding, many rows visible at once. The parent renderer constrains
 * the overall width to the composer.
 */
export const SlashMenuList = forwardRef<SlashMenuListRef, SlashMenuListProps>(
  ({ items, command }, ref) => {
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
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
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
          No matching skills
        </div>
      )
    }

    return (
      <div ref={listRef} className="slash-command-menu chat-slash-menu">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={`flex items-baseline gap-2 w-full px-2.5 py-1 rounded text-left transition-colors ${
              index === selectedIndex ? 'bg-accent' : 'hover:bg-accent/50'
            }`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="font-mono text-[11px] text-foreground shrink-0">
              /{item.name}
            </span>
            {item.description && (
              <span className="text-[11px] text-muted-foreground truncate min-w-0">
                {item.description}
              </span>
            )}
          </button>
        ))}
      </div>
    )
  },
)

SlashMenuList.displayName = 'SlashMenuList'
