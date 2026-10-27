'use client'

import { BubbleMenu } from '@tiptap/react/menus'
import { useEditorState, type ChainedCommands, type Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Highlighter,
  Link,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  List,
  ListOrdered,
  ListChecks,
  ListCollapse,
} from 'lucide-react'
import { Tip } from '@/components/ui/tip'

interface EditorBubbleMenuProps {
  editor: Editor
}

/** Turns the selected lines into a list, one item per paragraph. Pressed
 *  again on lines already in that list, it turns them back into paragraphs,
 *  and on another kind of list it switches the kind. */
export const LIST_FORMATS = [
  {
    node: 'bulletList',
    title: 'Bullet list',
    shortcut: '⌘⇧8',
    Icon: List,
    toggle: (chain: ChainedCommands) => chain.toggleBulletList(),
  },
  {
    node: 'orderedList',
    title: 'Numbered list',
    shortcut: '⌘⇧7',
    Icon: ListOrdered,
    toggle: (chain: ChainedCommands) => chain.toggleOrderedList(),
  },
  {
    node: 'taskList',
    title: 'Checklist',
    shortcut: '⌘⇧9',
    Icon: ListChecks,
    toggle: (chain: ChainedCommands) => chain.toggleTaskList(),
  },
] as const

function MenuButton({
  onClick,
  isActive,
  children,
  title,
  shortcut,
}: {
  onClick: () => void
  isActive?: boolean
  children: React.ReactNode
  title: string
  shortcut?: string
}) {
  return (
    <Tip label={title} shortcut={shortcut}>
      <button
        type="button"
        aria-label={title}
        aria-pressed={isActive ?? false}
        onClick={onClick}
        className={`
        p-1.5 rounded transition-colors duration-100
        ${
          isActive
            ? 'bg-primary/15 text-primary'
            : 'text-foreground/70 hover:text-foreground hover:bg-accent'
        }
      `}
      >
        {children}
      </button>
    </Tip>
  )
}

/** A run of related buttons with a divider in front. The divider sits a pixel
 *  outside the group, so when a narrow screen wraps the group onto a new row,
 *  the menu clips it rather than starting the row with a stray line. */
function MenuGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative -ml-px flex shrink-0 items-center gap-0.5 px-1">
      <div aria-hidden className="absolute left-0 h-5 w-px bg-border" />
      {children}
    </div>
  )
}

/** How many rows groups of these widths fill at `width`, left to right. */
function rowsAt(widths: readonly number[], width: number): number {
  let rows = 1
  let used = 0
  for (const w of widths) {
    if (used > 0 && used + w > width) {
      rows++
      used = 0
    }
    used += w
  }
  return rows
}

/** The narrowest width that fits groups of these widths in as few rows as
 *  `available` allows. A row only ends between groups, so the answer is the
 *  width of some run of neighboring groups: the shortest run that keeps the
 *  row count. When even the widest group doesn't fit, that group's width. */
export function balancedMenuWidth(widths: readonly number[], available: number): number {
  const widest = Math.max(0, ...widths)
  if (available <= widest) return widest
  const rows = rowsAt(widths, available)
  let best = available
  for (let start = 0; start < widths.length; start++) {
    let run = 0
    for (let end = start; end < widths.length; end++) {
      run += widths[end]
      // Narrower than the widest group would leave that group overflowing
      if (run >= widest && run < best && rowsAt(widths, run) <= rows) best = run
    }
  }
  return best
}

/** Sizes the menu box to its groups (see balancedMenuWidth). */
function fitMenuWidth(menu: HTMLElement, availableWidth: number) {
  const row = menu.firstElementChild
  // Not laid out (display: none) measures as zero: size it once it shows.
  if (!(row instanceof HTMLElement) || menu.offsetWidth === 0) return
  // Layout widths, not getBoundingClientRect: a scaled panel would skew those.
  const chrome = menu.offsetWidth - row.clientWidth
  const widths = Array.from(row.children, (group) => {
    const style = getComputedStyle(group)
    return (group as HTMLElement).offsetWidth + parseFloat(style.marginLeft) + parseFloat(style.marginRight)
  })
  // +1 so a row that fits exactly isn't wrapped by subpixel rounding
  const width = balancedMenuWidth(widths, availableWidth - chrome) + chrome + 1
  // max-width, since Tiptap sets width: max-content after every positioning
  menu.style.maxWidth = `${Math.ceil(width)}px`
}

export function EditorBubbleMenu({ editor }: EditorBubbleMenuProps) {
  const iconSize = 15
  // The editor doesn't re-render on transactions, so read what the selection
  // is in through useEditorState. Otherwise a button stays lit (or dark) for
  // whatever was selected the last time the parent happened to render.
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      code: editor.isActive('code'),
      highlight: editor.isActive('highlight'),
      heading1: editor.isActive('collapsibleHeading', { level: 1 }),
      heading2: editor.isActive('collapsibleHeading', { level: 2 }),
      heading3: editor.isActive('collapsibleHeading', { level: 3 }),
      lists: LIST_FORMATS.map((format) => editor.isActive(format.node)),
      blockquote: editor.isActive('blockquote'),
      toggle: editor.isActive('toggle'),
      link: editor.isActive('link'),
    }),
  })

  return (
    <BubbleMenu
      editor={editor}
      options={{
        placement: 'top',
        offset: 8,
        shift: { padding: 8 },
        // One row when it fits. Otherwise the groups wrap, and the menu takes
        // the narrowest width that needs no more rows, so it hugs its longest
        // row and the rows come out even. Left to CSS, wrapped flex content
        // keeps the full available width and leaves every row short.
        size: {
          padding: 8,
          apply: ({ availableWidth, elements }) => fitMenuWidth(elements.floating, availableWidth),
        },
      }}
      // z-[51]: above the gutter's grip and + (z-index 50 in globals.css),
      // which otherwise paint over the first buttons on a list or indented line.
      className="z-[51] px-0.5 py-1 rounded-lg border border-border bg-popover shadow-lg"
    >
      <div className="flex flex-wrap items-center gap-y-0.5 overflow-hidden">
        <MenuGroup>
          <MenuButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={active.bold}
            title="Bold"
            shortcut="⌘B"
          >
            <Bold size={iconSize} />
          </MenuButton>

          <MenuButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={active.italic}
            title="Italic"
            shortcut="⌘I"
          >
            <Italic size={iconSize} />
          </MenuButton>

          <MenuButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            isActive={active.underline}
            title="Underline"
            shortcut="⌘U"
          >
            <Underline size={iconSize} />
          </MenuButton>

          <MenuButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            isActive={active.strike}
            title="Strikethrough"
          >
            <Strikethrough size={iconSize} />
          </MenuButton>

          <MenuButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            isActive={active.code}
            title="Inline code"
            shortcut="⌘E"
          >
            <Code size={iconSize} />
          </MenuButton>

          <MenuButton
            onClick={() => editor.chain().focus().toggleHighlight().run()}
            isActive={active.highlight}
            title="Highlight"
          >
            <Highlighter size={iconSize} />
          </MenuButton>

          <MenuButton
            onClick={() => {
              const previousUrl = editor.getAttributes('link').href
              const url = window.prompt('URL', previousUrl)
              if (url === null) return
              if (url === '') {
                editor.chain().focus().extendMarkRange('link').unsetLink().run()
                return
              }
              editor
                .chain()
                .focus()
                .extendMarkRange('link')
                .setLink({ href: url })
                .run()
            }}
            isActive={active.link}
            title="Link"
            shortcut="⌘K"
          >
            <Link size={iconSize} />
          </MenuButton>
        </MenuGroup>

        <MenuGroup>
          <MenuButton
            onClick={() =>
              editor
                .chain()
                .focus()
                .toggleNode('collapsibleHeading', 'paragraph', { level: 1 })
                .run()
            }
            isActive={active.heading1}
            title="Heading 1"
          >
            <Heading1 size={iconSize} />
          </MenuButton>

          <MenuButton
            onClick={() =>
              editor
                .chain()
                .focus()
                .toggleNode('collapsibleHeading', 'paragraph', { level: 2 })
                .run()
            }
            isActive={active.heading2}
            title="Heading 2"
          >
            <Heading2 size={iconSize} />
          </MenuButton>

          <MenuButton
            onClick={() =>
              editor
                .chain()
                .focus()
                .toggleNode('collapsibleHeading', 'paragraph', { level: 3 })
                .run()
            }
            isActive={active.heading3}
            title="Heading 3"
          >
            <Heading3 size={iconSize} />
          </MenuButton>
        </MenuGroup>

        <MenuGroup>
          {LIST_FORMATS.map(({ node, title, shortcut, Icon, toggle }, i) => (
            <MenuButton
              key={node}
              onClick={() => toggle(editor.chain().focus()).run()}
              isActive={active.lists[i]}
              title={title}
              shortcut={shortcut}
            >
              <Icon size={iconSize} />
            </MenuButton>
          ))}
        </MenuGroup>

        <MenuGroup>
          <MenuButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            isActive={active.blockquote}
            title="Quote"
          >
            <Quote size={iconSize} />
          </MenuButton>

          <MenuButton
            onClick={() => editor.chain().focus().setToggle().run()}
            isActive={active.toggle}
            title="Turn into toggle"
          >
            <ListCollapse size={iconSize} />
          </MenuButton>
        </MenuGroup>
      </div>
    </BubbleMenu>
  )
}
