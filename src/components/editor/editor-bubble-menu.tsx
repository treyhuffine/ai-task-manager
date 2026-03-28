'use client'

import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'
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
} from 'lucide-react'

interface EditorBubbleMenuProps {
  editor: Editor
}

function MenuButton({
  onClick,
  isActive,
  children,
  title,
}: {
  onClick: () => void
  isActive?: boolean
  children: React.ReactNode
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
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
  )
}

function MenuDivider() {
  return <div className="w-px h-5 bg-border mx-0.5" />
}

export function EditorBubbleMenu({ editor }: EditorBubbleMenuProps) {
  const iconSize = 15

  return (
    <BubbleMenu
      editor={editor}
      options={{
        placement: 'top',
        offset: 8,
      }}
      className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg border border-border bg-popover shadow-lg"
    >
      {/* Text formatting */}
      <MenuButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="Bold (⌘B)"
      >
        <Bold size={iconSize} />
      </MenuButton>

      <MenuButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="Italic (⌘I)"
      >
        <Italic size={iconSize} />
      </MenuButton>

      <MenuButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive('underline')}
        title="Underline (⌘U)"
      >
        <Underline size={iconSize} />
      </MenuButton>

      <MenuButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        title="Strikethrough"
      >
        <Strikethrough size={iconSize} />
      </MenuButton>

      <MenuButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive('code')}
        title="Inline code (⌘E)"
      >
        <Code size={iconSize} />
      </MenuButton>

      <MenuButton
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        isActive={editor.isActive('highlight')}
        title="Highlight"
      >
        <Highlighter size={iconSize} />
      </MenuButton>

      <MenuDivider />

      {/* Block type */}
      <MenuButton
        onClick={() =>
          editor
            .chain()
            .focus()
            .toggleNode('collapsibleHeading', 'paragraph', { level: 1 })
            .run()
        }
        isActive={
          editor.isActive('collapsibleHeading', { level: 1 })
        }
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
        isActive={
          editor.isActive('collapsibleHeading', { level: 2 })
        }
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
        isActive={
          editor.isActive('collapsibleHeading', { level: 3 })
        }
        title="Heading 3"
      >
        <Heading3 size={iconSize} />
      </MenuButton>

      <MenuDivider />

      <MenuButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive('blockquote')}
        title="Quote"
      >
        <Quote size={iconSize} />
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
        isActive={editor.isActive('link')}
        title="Link (⌘K)"
      >
        <Link size={iconSize} />
      </MenuButton>
    </BubbleMenu>
  )
}
