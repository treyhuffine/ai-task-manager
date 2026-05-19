'use client'

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useImperativeHandle,
  forwardRef,
} from 'react'
import { Folder } from 'lucide-react'
import { FileIcon } from '@/components/file-icon'
import type { SuggestionPopupRef } from '../suggestion/renderer'
import type { MentionItem } from './types'

interface MentionMenuListProps {
  items: MentionItem[]
  command: (item: MentionItem) => void
}

/**
 * @-mention popup. Renders each file/folder match as a one-line row
 * with the basename in mono on the left and the parent directory in
 * dimmer text on the right, so the user can disambiguate two files
 * with the same basename in different directories at a glance.
 */
export const MentionMenuList = forwardRef<SuggestionPopupRef, MentionMenuListProps>(
  function MentionMenuList({ items, command }, ref) {
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
          No matching files
        </div>
      )
    }

    return (
      <div ref={listRef} className="slash-command-menu chat-slash-menu">
        {items.map((item, index) => {
          const slash = item.path.lastIndexOf('/')
          const parent = slash === -1 ? '' : item.path.slice(0, slash)
          return (
            <button
              key={item.path}
              type="button"
              className={`flex items-center gap-2 w-full px-2.5 py-1 rounded text-left transition-colors ${
                index === selectedIndex ? 'bg-accent' : 'hover:bg-accent/50'
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectItem(index)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="shrink-0 flex items-center justify-center w-3.5">
                {item.kind === 'dir' ? (
                  <Folder size={11} className="text-muted-foreground/80" />
                ) : (
                  <FileIcon name={item.name} size={11} />
                )}
              </span>
              <span className="font-mono text-[11px] text-foreground shrink-0">
                {item.name}
              </span>
              {parent && (
                <span className="text-[11px] text-muted-foreground/70 truncate min-w-0">
                  {parent}
                </span>
              )}
            </button>
          )
        })}
      </div>
    )
  },
)
