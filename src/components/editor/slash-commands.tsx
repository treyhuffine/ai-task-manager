'use client'

import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion, { type SuggestionOptions, type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion'
import { createSuggestionPopupRenderer } from '@/components/chat/editor/suggestion/renderer'
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
  ListCollapse,
  Link2,
} from 'lucide-react'
import type { Attachment } from '@/db/types'
import { insertUploadedFiles, type AttachmentStore } from './upload-files'

// --- Command definitions ---

interface SlashCommandItem {
  title: string
  description: string
  icon: React.ComponentType<{ size?: number }>
  command: (props: { editor: Editor; range: Range }) => void
}

interface SlashCommandsBuildContext {
  /** Called when an image is uploaded so the parent can include its metadata
   *  in the next save payload. */
  getAttachmentHandler: () => ((a: Attachment) => void) | undefined
  /** Where the files go, when not this Ri's own attachments. */
  getAttachmentStore: () => AttachmentStore | undefined
}

/** Open the system file picker and insert the chosen images at `insertAt`. */
function pickAndInsertImages(
  editor: Editor,
  insertAt: number,
  onAttachment?: (a: Attachment) => void,
  store?: AttachmentStore,
) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return
    void insertUploadedFiles(editor, files, insertAt, onAttachment, store)
  })
  input.click()
}

function buildSlashCommands(ctx: SlashCommandsBuildContext): SlashCommandItem[] {
  return [
  {
    title: 'Link',
    description: 'Link to a task or note',
    icon: Link2,
    command: ({ editor, range }) => {
      // Hand off to the `@` entity picker: replace the slash trigger with an
      // `@` so the entity-link suggestion opens at the caret.
      editor.chain().focus().deleteRange(range).insertContent('@').run()
    },
  },
  {
    title: 'Image',
    description: 'Upload an image from your device',
    icon: ImageIcon,
    command: ({ editor, range }) => {
      // Delete the slash trigger before opening the picker — keeps the
      // saved insertion position stable even if focus moves while the
      // file dialog is open. The helper also clamps to doc size, so a
      // shrunken document after async work is still safe.
      editor.chain().focus().deleteRange(range).run()
      const insertAt = editor.state.selection.to
      pickAndInsertImages(editor, insertAt, ctx.getAttachmentHandler(), ctx.getAttachmentStore())
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
    title: 'Toggle',
    description: 'Collapsible section',
    icon: ListCollapse,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setToggle().run()
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
}

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

    const [prevItems, setPrevItems] = useState(items)
    if (items !== prevItems) {
      setPrevItems(items)
      setSelectedIndex(0)
    }

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

// --- Tiptap Extension ---

interface SlashCommandsOptions {
  /** Returns the current attachment callback. Wrapped in a getter so the
   *  extension always sees the latest callback even though its options are
   *  frozen at editor-create time. */
  getAttachmentHandler?: () => ((a: Attachment) => void) | undefined
  getAttachmentStore?: () => AttachmentStore | undefined
}

export const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: 'slashCommands',

  addOptions() {
    return {
      getAttachmentHandler: undefined,
      getAttachmentStore: undefined,
    }
  },

  addProseMirrorPlugins() {
    const buildCtx: SlashCommandsBuildContext = {
      getAttachmentHandler: () => this.options.getAttachmentHandler?.(),
      getAttachmentStore: () => this.options.getAttachmentStore?.(),
    }
    const suggestion: Partial<SuggestionOptions<SlashCommandItem, SlashCommandItem>> = {
      char: '/',
      allowSpaces: false,
      startOfLine: false,
      items: ({ query }: { query: string }) => {
        return buildSlashCommands(buildCtx).filter((item) =>
          item.title.toLowerCase().includes(query.toLowerCase())
        )
      },
      command: ({
        editor,
        range,
        props: item,
      }: {
        editor: SuggestionProps<SlashCommandItem>['editor']
        range: Range
        props: SlashCommandItem
      }) => {
        item.command({ editor, range })
      },
      render: createSuggestionPopupRenderer<SlashCommandItem>(CommandList, {
        placement: 'bottom-start',
        matchEditorWidth: false,
        gap: 4,
      }),
    }

    return [
      Suggestion<SlashCommandItem, SlashCommandItem>({
        editor: this.editor,
        ...suggestion,
      }),
    ]
  },
})
