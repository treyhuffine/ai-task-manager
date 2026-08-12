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
import { isSuggestionCommitKey, suggestionNavDelta } from '../suggestion/keys'
import { highlightSegments, type CommandMatch } from './ranking'

export interface SlashMenuListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

interface SlashMenuListProps {
  items: CommandMatch[]
  command: (item: CommandMatch) => void
}

/**
 * Emphasize the characters the query actually matched. With no cap on the
 * list this is what keeps a long result set legible: the top rows visibly
 * matched the command name, the tail visibly matched a description word, and
 * nothing looks like it arrived by accident.
 *
 * The theme is monochrome, so there is no accent hue to highlight with —
 * contrast does the work instead. The same class pair reads correctly in both
 * slots: on the foreground-colored name, unmatched characters recede to muted;
 * on the already-muted description, matched characters step forward.
 */
function Highlighted({ text, matches }: { text: string; matches: number[] }) {
  if (matches.length === 0) return <>{text}</>
  return (
    <>
      {highlightSegments(text, matches).map((seg, i) => (
        <span
          key={i}
          className={seg.match ? 'text-foreground font-medium' : 'text-muted-foreground'}
        >
          {seg.text}
        </span>
      ))}
    </>
  )
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
          No matching skills
        </div>
      )
    }

    return (
      <div ref={listRef} className="slash-command-menu chat-slash-menu">
        {items.map((item, index) => (
          <button
            key={item.command.id}
            type="button"
            className={`flex items-baseline gap-2 w-full px-2.5 py-1 rounded text-left transition-colors ${
              index === selectedIndex ? 'bg-accent' : 'hover:bg-accent/50'
            }`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="font-mono text-[11px] text-foreground shrink-0">
              /<Highlighted text={item.command.name} matches={item.nameMatches} />
            </span>
            {item.command.description && (
              <span className="text-[11px] text-muted-foreground truncate min-w-0">
                <Highlighted
                  text={item.command.description}
                  matches={item.descriptionMatches}
                />
              </span>
            )}
          </button>
        ))}
      </div>
    )
  },
)

SlashMenuList.displayName = 'SlashMenuList'
