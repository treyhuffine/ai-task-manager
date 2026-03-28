'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import CharacterCount from '@tiptap/extension-character-count'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'

import { CollapsibleHeading } from './collapsible-heading'
import { EditorBubbleMenu } from './editor-bubble-menu'
import { EditorGutterMenu } from './editor-floating-menu'
import { SlashCommands } from './slash-commands'
import { useCallback, useRef } from 'react'

const lowlight = createLowlight(common)

export interface RichEditorProps {
  /** Initial content as markdown string */
  content?: string
  /** Called when content changes, with markdown string */
  onChange?: (markdown: string) => void
  /** Placeholder text for body */
  placeholder?: string
  /** Whether the editor is read-only */
  editable?: boolean
  /** Additional class names for the editor wrapper */
  className?: string
  /** Auto-focus the editor on mount */
  autoFocus?: 'start' | 'end' | false;
  /** Hide the built-in word/character count footer */
  hideFooter?: boolean
}

export function RichEditor({
  content = '',
  onChange,
  placeholder = "Start writing, or type '/' for commands...",
  editable = true,
  className = '',
  autoFocus = false,
  hideFooter = false,
}: RichEditorProps) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
      }),
      CollapsibleHeading,
      Markdown,
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'collapsibleHeading') {
            return node.attrs.level === 1
              ? 'Heading 1'
              : node.attrs.level === 2
                ? 'Heading 2'
                : 'Heading 3'
          }
          return placeholder
        },
        showOnlyCurrent: true,
      }),
      Typography,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: false }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline underline-offset-2 cursor-pointer',
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'rounded-lg max-w-full',
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      CharacterCount,
      SlashCommands,
    ],
    content,
    ...(content ? { contentType: 'markdown' as any } : {}),
    editorProps: {
      attributes: {
        class: 'rich-editor-body outline-none',
        spellcheck: 'true',
        // Disable Grammarly — it fights with ProseMirror's DOM and causes infinite loops
        'data-gramm': 'false',
        'data-gramm_editor': 'false',
        'data-enable-grammarly': 'false',
      },
    },
    onUpdate: ({ editor }) => {
      if (onChangeRef.current) {
        const md = (editor as any).getMarkdown?.() ?? ''
        onChangeRef.current(md)
      }
    },
    autofocus: autoFocus ? autoFocus : false,
  })

  if (!editor) {
    return (
      <div className={`rich-editor-skeleton animate-pulse ${className}`}>
        <div className="h-4 bg-muted rounded w-3/4 mb-3" />
        <div className="h-3 bg-muted rounded w-full mb-2" />
        <div className="h-3 bg-muted rounded w-5/6 mb-2" />
        <div className="h-3 bg-muted rounded w-2/3" />
      </div>
    )
  }

  return (
    <div className={`rich-editor relative ${className}`}>
      <EditorBubbleMenu editor={editor} />
      <EditorGutterMenu editor={editor} />
      <EditorContent editor={editor} />
      {editor && !hideFooter && (
        <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border text-xs text-muted-foreground">
          <span>{editor.storage.characterCount.words()} words</span>
          <span>{editor.storage.characterCount.characters()} characters</span>
        </div>
      )}
    </div>
  )
}

export interface NoteEditorProps {
  title?: string
  body?: string
  onTitleChange?: (title: string) => void
  onBodyChange?: (markdown: string) => void
  /** Focus the title field on mount instead of the body */
  autoFocusTitle?: boolean
  /** Hide the built-in word/character count footer (e.g. when shown elsewhere) */
  hideFooter?: boolean
}

export function NoteEditor({
  title = '',
  body = '',
  onTitleChange,
  onBodyChange,
  autoFocusTitle = false,
  hideFooter = false,
}: NoteEditorProps) {
  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        const editorEl = document.querySelector('.rich-editor-body')
        if (editorEl instanceof HTMLElement) {
          editorEl.focus()
        }
      }
    },
    []
  )

  const handleTitleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      const target = e.currentTarget
      target.style.height = 'auto'
      target.style.height = target.scrollHeight + 'px'
      onTitleChange?.(target.value)
    },
    [onTitleChange]
  )

  return (
    <div className="note-editor w-full mx-auto pb-16 px-16">
      {/* Title */}
      <textarea
        className="note-title w-full text-[2.5rem] font-bold leading-tight bg-transparent border-none outline-none resize-none overflow-hidden text-foreground placeholder:text-muted-foreground/40"
        placeholder="Note title"
        defaultValue={title}
        onInput={handleTitleInput}
        onKeyDown={handleTitleKeyDown}
        autoFocus={autoFocusTitle}
        rows={1}
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
      />

      {/* Body — the gutter menu lives in the pl-16 space */}
      <div className="mt-6">
        <RichEditor
          content={body}
          onChange={onBodyChange}
          autoFocus={autoFocusTitle ? false : 'start'}
          hideFooter={hideFooter}
        />
      </div>
    </div>
  )
}
