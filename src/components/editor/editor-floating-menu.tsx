'use client'

import type { Editor } from '@tiptap/react'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus,
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
} from 'lucide-react'

interface EditorGutterMenuProps {
  editor: Editor
}

function MenuItem({
  onClick,
  icon: Icon,
  label,
  shortcut,
}: {
  onClick: () => void
  icon: React.ComponentType<{ size?: number }>
  label: string
  shortcut?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded text-sm text-foreground/80 hover:text-foreground hover:bg-accent transition-colors"
    >
      <Icon size={16} />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && (
        <span className="text-xs text-muted-foreground">{shortcut}</span>
      )}
    </button>
  )
}

/**
 * A "+" button in the left gutter that appears on empty paragraphs.
 * Clicking opens a dropdown with block type options (like Medium/Notion).
 */
export function EditorGutterMenu({ editor }: EditorGutterMenuProps) {
  const [visible, setVisible] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0 })
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Track cursor position and show + button on empty top-level paragraphs
  useEffect(() => {
    const updateVisibility = () => {
      const { state } = editor
      const { $from } = state.selection
      const currentNode = $from.parent
      const isEmptyParagraph =
        currentNode.type.name === 'paragraph' &&
        currentNode.content.size === 0
      const isTopLevel = $from.depth <= 1

      if (isEmptyParagraph && isTopLevel) {
        // Get the DOM position of the current paragraph
        const coords = editor.view.coordsAtPos($from.pos)
        const editorRect = editor.view.dom.getBoundingClientRect()
        setPosition({ top: coords.top - editorRect.top })
        setVisible(true)
      } else {
        setVisible(false)
        setMenuOpen(false)
      }
    }

    editor.on('selectionUpdate', updateVisibility)
    editor.on('update', updateVisibility)

    return () => {
      editor.off('selectionUpdate', updateVisibility)
      editor.off('update', updateVisibility)
    }
  }, [editor])

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  const runCommand = useCallback(
    (command: () => void) => {
      command()
      setMenuOpen(false)
    },
    []
  )

  if (!visible) return null

  return (
    <div
      className="editor-gutter-menu"
      style={{ top: position.top }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className={`
          gutter-plus-button
          flex items-center justify-center
          w-6 h-6 rounded
          transition-all duration-150
          text-muted-foreground/50 hover:text-foreground hover:bg-accent
          ${menuOpen ? 'text-foreground bg-accent' : ''}
        `}
        aria-label="Add block"
      >
        <Plus
          size={18}
          className={`transition-transform duration-200 ${menuOpen ? 'rotate-45' : ''}`}
        />
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute left-0 top-8 z-50 flex flex-col gap-0.5 p-1.5 rounded-lg border border-border bg-popover shadow-lg min-w-[200px]"
        >
          <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Blocks
          </div>

          <MenuItem
            onClick={() =>
              runCommand(() =>
                editor
                  .chain()
                  .focus()
                  .setNode('collapsibleHeading', { level: 1 })
                  .run()
              )
            }
            icon={Heading1}
            label="Heading 1"
            shortcut="#"
          />
          <MenuItem
            onClick={() =>
              runCommand(() =>
                editor
                  .chain()
                  .focus()
                  .setNode('collapsibleHeading', { level: 2 })
                  .run()
              )
            }
            icon={Heading2}
            label="Heading 2"
            shortcut="##"
          />
          <MenuItem
            onClick={() =>
              runCommand(() =>
                editor
                  .chain()
                  .focus()
                  .setNode('collapsibleHeading', { level: 3 })
                  .run()
              )
            }
            icon={Heading3}
            label="Heading 3"
            shortcut="###"
          />

          <div className="h-px bg-border my-1" />

          <MenuItem
            onClick={() =>
              runCommand(() =>
                editor.chain().focus().toggleBulletList().run()
              )
            }
            icon={List}
            label="Bullet list"
            shortcut="-"
          />
          <MenuItem
            onClick={() =>
              runCommand(() =>
                editor.chain().focus().toggleOrderedList().run()
              )
            }
            icon={ListOrdered}
            label="Numbered list"
            shortcut="1."
          />
          <MenuItem
            onClick={() =>
              runCommand(() =>
                editor.chain().focus().toggleTaskList().run()
              )
            }
            icon={ListChecks}
            label="Task list"
          />

          <div className="h-px bg-border my-1" />

          <MenuItem
            onClick={() =>
              runCommand(() =>
                editor.chain().focus().toggleBlockquote().run()
              )
            }
            icon={Quote}
            label="Quote"
            shortcut=">"
          />
          <MenuItem
            onClick={() =>
              runCommand(() =>
                editor.chain().focus().toggleCodeBlock().run()
              )
            }
            icon={Code2}
            label="Code block"
            shortcut="```"
          />
          <MenuItem
            onClick={() =>
              runCommand(() =>
                editor.chain().focus().setHorizontalRule().run()
              )
            }
            icon={Minus}
            label="Divider"
            shortcut="---"
          />
          <MenuItem
            onClick={() =>
              runCommand(() => {
                const url = window.prompt('Image URL')
                if (url) {
                  editor.chain().focus().setImage({ src: url }).run()
                }
              })
            }
            icon={ImageIcon}
            label="Image"
          />
        </div>
      )}
    </div>
  )
}
