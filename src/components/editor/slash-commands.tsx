'use client'

import { Extension } from '@tiptap/core'
import Suggestion, { type SuggestionOptions, type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion'
import { createRoot, type Root } from 'react-dom/client'
import { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react'
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Code2,
  Quote,
  Minus,
  ImageIcon,
  TextIcon,
} from 'lucide-react'

// --- Command definitions ---

interface SlashCommandItem {
  title: string
  description: string
  icon: React.ComponentType<{ size?: number }>
  command: (props: { editor: any; range: any }) => void
}

const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    title: 'Image',
    description: 'Embed an image from URL',
    icon: ImageIcon,
    command: ({ editor, range }) => {
      const url = window.prompt('Image URL')
      if (url) {
        editor.chain().focus().deleteRange(range).setImage({ src: url }).run()
      }
    },
  },
  {
    title: 'Text',
    description: 'Plain text paragraph',
    icon: TextIcon,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('paragraph').run()
    },
  },
  {
    title: 'Heading 1',
    description: 'Large heading',
    icon: Heading1,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('collapsibleHeading', { level: 1 }).run()
    },
  },
  {
    title: 'Heading 2',
    description: 'Medium heading',
    icon: Heading2,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('collapsibleHeading', { level: 2 }).run()
    },
  },
  {
    title: 'Heading 3',
    description: 'Small heading',
    icon: Heading3,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('collapsibleHeading', { level: 3 }).run()
    },
  },
  {
    title: 'Bullet List',
    description: 'Unordered list',
    icon: List,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
  },
  {
    title: 'Numbered List',
    description: 'Ordered list',
    icon: ListOrdered,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
  },
  {
    title: 'Task List',
    description: 'Checklist with todos',
    icon: ListChecks,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run()
    },
  },
  {
    title: 'Quote',
    description: 'Blockquote',
    icon: Quote,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    },
  },
  {
    title: 'Code Block',
    description: 'Syntax-highlighted code',
    icon: Code2,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
    },
  },
  {
    title: 'Divider',
    description: 'Horizontal rule',
    icon: Minus,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run()
    },
  },
]

// --- React popup component ---

interface CommandListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

interface CommandListProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
}

const CommandList = forwardRef<CommandListRef, CommandListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const listRef = useRef<HTMLDivElement>(null)

    // Reset selection when items change
    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    // Scroll selected item into view
    useEffect(() => {
      const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
      el?.scrollIntoView({ block: 'nearest' })
    }, [selectedIndex])

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index]
        if (item) command(item)
      },
      [items, command]
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
        if (event.key === 'Enter') {
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
        <div className="slash-command-menu p-3 text-sm text-muted-foreground">
          No matching commands
        </div>
      )
    }

    return (
      <div ref={listRef} className="slash-command-menu">
        {items.map((item, index) => {
          const Icon = item.icon
          return (
            <button
              key={item.title}
              type="button"
              className={`
                flex items-center gap-2.5 w-full px-2.5 py-2 rounded text-sm transition-colors
                ${index === selectedIndex
                  ? 'bg-accent text-foreground'
                  : 'text-foreground/80 hover:bg-accent/50'
                }
              `}
              // Per-button preventDefault keeps editor focus on click so the
              // Suggestion plugin doesn't tear the popup down before click
              // fires. Scoped to the button so scrollbar drags on the
              // container still work.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectItem(index)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded border border-border bg-background">
                <Icon size={16} />
              </div>
              <div className="text-left">
                <div className="font-medium">{item.title}</div>
                <div className="text-xs text-muted-foreground">{item.description}</div>
              </div>
            </button>
          )
        })}
      </div>
    )
  }
)

CommandList.displayName = 'CommandList'

// --- Suggestion render using vanilla DOM + React root ---

function createSuggestionRenderer() {
  return () => {
    let popup: HTMLDivElement | null = null
    let root: Root | null = null
    let componentRef: CommandListRef | null = null
    let host: HTMLElement = document.body

    return {
      onStart(props: SuggestionProps<SlashCommandItem>) {
        popup = document.createElement('div')
        popup.className = 'slash-command-popup'
        // Mount inside the nearest Radix Dialog when present — Radix sets
        // pointer-events: none on body siblings of a modal dialog, which would
        // otherwise block clicks and scrollbar drags on the menu.
        const editorDom = props.editor.view.dom as HTMLElement
        host =
          (editorDom.closest('[role="dialog"]') as HTMLElement | null) ??
          (editorDom.closest('[data-radix-popper-content-wrapper]') as HTMLElement | null) ??
          document.body
        host.appendChild(popup)

        root = createRoot(popup)
        root.render(
          <CommandList
            ref={(r) => { componentRef = r }}
            items={props.items}
            command={(item) => {
              props.command(item)
            }}
          />
        )

        updatePosition(popup, props)
      },

      onUpdate(props: SuggestionProps<SlashCommandItem>) {
        root?.render(
          <CommandList
            ref={(r) => { componentRef = r }}
            items={props.items}
            command={(item) => {
              props.command(item)
            }}
          />
        )

        if (popup) updatePosition(popup, props)
      },

      onKeyDown(props: SuggestionKeyDownProps) {
        if (props.event.key === 'Escape') {
          cleanup()
          return true
        }
        return componentRef?.onKeyDown(props) ?? false
      },

      onExit() {
        cleanup()
      },
    }

    function updatePosition(
      el: HTMLDivElement,
      props: SuggestionProps<SlashCommandItem>
    ) {
      const rect = props.clientRect?.()
      if (!rect) return
      // `clientRect` is viewport-relative. When the host is a transformed
      // ancestor (e.g. a Radix Dialog with a slide-in transform), `position:
      // fixed` resolves against that ancestor's box, so we subtract its
      // origin to land at the caret. For the body fallback, hostRect is at
      // 0,0 and the math degenerates to plain viewport coords.
      const hostRect =
        host === document.body
          ? { left: 0, top: 0 }
          : host.getBoundingClientRect()
      el.style.position = 'fixed'
      el.style.left = `${rect.left - hostRect.left}px`
      el.style.top = `${rect.bottom - hostRect.top + 4}px`
      el.style.zIndex = '999'
    }

    function cleanup() {
      root?.unmount()
      root = null
      popup?.remove()
      popup = null
      componentRef = null
    }
  }
}

// --- Tiptap Extension ---

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }: { query: string }) => {
          return SLASH_COMMANDS.filter((item) =>
            item.title.toLowerCase().includes(query.toLowerCase())
          )
        },
        command: ({
          editor,
          range,
          props: item,
        }: {
          editor: any
          range: any
          props: SlashCommandItem
        }) => {
          item.command({ editor, range })
        },
        render: createSuggestionRenderer(),
      } satisfies Partial<SuggestionOptions<SlashCommandItem, SlashCommandItem>>,
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem, SlashCommandItem>({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})
