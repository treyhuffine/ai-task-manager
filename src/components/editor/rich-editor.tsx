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
import { DragHandle } from './drag-handle'
import AutoJoiner from 'tiptap-extension-auto-joiner'
import {
  CollapsibleHeading,
  applyFoldedHeadingIds,
  getFoldedHeadingIds,
} from './collapsible-heading'
import { Paragraph } from './paragraph'
import { EditorBubbleMenu } from './editor-bubble-menu'
import { ListKeymap } from './list-keymap'
import { SlashCommands } from './slash-commands'
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import type { Attachment } from '@/db/types'
import { insertUploadedFiles } from './upload-files'

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
  /** Called when a file is uploaded via drag/drop/paste. The parent should
   *  accumulate these in a ref and include them in the save payload so the
   *  server can populate attachment metadata (original_name, mime_type, size)
   *  on the entity's manifest without a cross-entity lookup. */
  onAttachment?: (attachment: Attachment) => void
  /** Heading IDs that should be folded on initial render. Identity is `${ordinal}:${text}`
   *  — see collapsible-heading.tsx. Survives reorders/inserts; lost on rename or
   *  level change (toggle to re-set). */
  foldedHeadings?: readonly string[]
  /** Fires when the user toggles a heading fold. The full current set is sent
   *  every time so the parent just persists `folded_headings = arg`. */
  onFoldedHeadingsChange?: (folded: string[]) => void
}

export function RichEditor({
  content = '',
  onChange,
  placeholder = "Start writing, or type '/' for commands...",
  editable = true,
  className = '',
  autoFocus = false,
  hideFooter = false,
  onAttachment,
  foldedHeadings,
  onFoldedHeadingsChange,
}: RichEditorProps) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const onAttachmentRef = useRef(onAttachment)
  onAttachmentRef.current = onAttachment

  const onFoldedChangeRef = useRef(onFoldedHeadingsChange)
  onFoldedChangeRef.current = onFoldedHeadingsChange

  // Folded set we last applied / emitted — guards against re-applying on every
  // doc update and against echoing changes the parent just told us about.
  const foldedRef = useRef<readonly string[]>(foldedHeadings ?? [])

  // The drop/paste handlers need the live Editor (for schema-aware
  // `insertContentAt`) but `useEditor`'s editorProps callbacks close over
  // the still-uninitialized `editor` const. A ref bridges that — it's set
  // imperatively below after `useEditor` returns, and read at event time.
  const editorRef = useRef<Editor | null>(null)

  // Freeze initial content so useEditor only uses it on creation.
  // We handle subsequent updates ourselves via the sync effect below.
  const initialContentRef = useRef(content)

  // Track whether we're in the middle of an external (prop-driven) sync so
  // the onUpdate handler can skip firing onChange, which would trigger a
  // debounced save that could overwrite the AI's DB write with stale content.
  const isSyncingRef = useRef(false)
  const prevContentRef = useRef(content)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        // Replaced with a patched Paragraph below — upstream's
        // renderMarkdown drops blank lines adjacent to headings.
        // See src/components/editor/paragraph.ts for the why.
        paragraph: false,
      }),
      Paragraph,
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
      SlashCommands.configure({
        getAttachmentHandler: () => onAttachmentRef.current,
      }),
      ListKeymap,
      DragHandle.configure({
        // see ./drag-handle.ts. Empty paragraphs are skipped by the block
        // detector so the "+" gutter button stays the only UI on those.
      }),
      AutoJoiner,
    ],
    content: initialContentRef.current,
    ...(initialContentRef.current ? { contentType: 'markdown' as any } : {}),
    editorProps: {
      attributes: {
        class: 'rich-editor-body outline-none',
        spellcheck: 'true',
        // Disable Grammarly — it fights with ProseMirror's DOM and causes infinite loops
        'data-gramm': 'false',
        'data-gramm_editor': 'false',
        'data-enable-grammarly': 'false',
      },
      // Drag-and-drop file uploads. Internal ProseMirror drags (node moves
      // within the doc) have `moved=true` and we ignore those — only external
      // file drops trigger the upload path.
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const editor = editorRef.current
        if (!editor) return false
        const dt = (event as DragEvent).dataTransfer
        const files = Array.from(dt?.files ?? []).filter((f) => f.type.startsWith('image/'))
        if (files.length === 0) return false
        event.preventDefault()
        const coords = view.posAtCoords({
          left: (event as DragEvent).clientX,
          top: (event as DragEvent).clientY,
        })
        const pos = coords?.pos ?? view.state.selection.to
        void insertUploadedFiles(editor, files, pos, onAttachmentRef.current)
        return true
      },
      handlePaste: (view, event) => {
        const editor = editorRef.current
        if (!editor) return false
        const cb = (event as ClipboardEvent).clipboardData
        const files = Array.from(cb?.files ?? []).filter((f) => f.type.startsWith('image/'))
        if (files.length === 0) return false
        event.preventDefault()
        const pos = view.state.selection.to
        void insertUploadedFiles(editor, files, pos, onAttachmentRef.current)
        return true
      },
    },
    onUpdate: ({ editor }) => {
      // During external syncs, suppress onChange to avoid re-saving stale content
      if (isSyncingRef.current) return
      const md = (editor as any).getMarkdown?.() ?? ''
      prevContentRef.current = md
      onChangeRef.current?.(md)
    },
    autofocus: autoFocus ? autoFocus : false,
  })

  editorRef.current = editor

  // Sync editable state at runtime (e.g. disable while AI is working).
  // Blur before disabling so the focus gate in the content-sync effect
  // releases and pending AI-driven body updates can apply. Pass emitUpdate=false
  // to prevent setEditable from firing onUpdate with stale content.
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      if (!editable && editor.isFocused) editor.commands.blur()
      editor.setEditable(editable, false)
    }
  }, [editor, editable])

  // Sync external content changes (e.g. AI tool updates) into the editor.
  // Skip while the editor is focused — the user is typing, and the prop is
  // almost always a stale echo from a debounced save round-trip. Overwriting
  // here is what produced the "words delete and reappear" jerkiness.
  // Deferred via queueMicrotask because TipTap's setContent calls flushSync,
  // which can't run inside a React useEffect (commit phase).
  useEffect(() => {
    if (!editor || content === prevContentRef.current) return
    if (editor.isFocused) return
    prevContentRef.current = content

    const currentMd = (editor as any).getMarkdown?.() ?? ''
    if (currentMd === content) return

    // Capture values for the deferred callback
    const markdownToSet = content
    queueMicrotask(() => {
      // Editor may have been destroyed by the time this runs
      if (editor.isDestroyed) return
      isSyncingRef.current = true
      try {
        const jsonContent = editor.markdown?.parse(markdownToSet)
        if (jsonContent) {
          const { from } = editor.state.selection
          editor.commands.setContent(jsonContent, { emitUpdate: false })
          const maxPos = editor.state.doc.content.size
          editor.commands.setTextSelection(Math.min(from, maxPos))
        }
      } finally {
        isSyncingRef.current = false
      }
      // Markdown round-trips strip the fold bit (parseMarkdown sets collapsed:false),
      // so reapply after every external sync.
      applyFoldedHeadingIds(editor, foldedRef.current)
    })
  }, [editor, content])

  // Apply initial folds once after the editor mounts. Keyed only on `editor`
  // (not on foldedHeadings) so the parent's saved-state echo doesn't keep
  // re-folding things the user just opened.
  useEffect(() => {
    if (!editor) return
    applyFoldedHeadingIds(editor, foldedRef.current)
  }, [editor])

  // Watch for fold toggles and report up. Diff against the last known set so we
  // only emit when the fold state actually changed (skipping plain text edits).
  useEffect(() => {
    if (!editor) return
    const handler = ({ editor: ed }: { editor: Editor }) => {
      const next = getFoldedHeadingIds(ed)
      const prev = foldedRef.current
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return
      foldedRef.current = next
      onFoldedChangeRef.current?.(next)
    }
    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
    }
  }, [editor])

  // Notion-style: clicks anywhere in the editor wrapper that miss the
  // contenteditable still focus the editor and drop the cursor at the end.
  // ProseMirror handles in-body clicks natively; we only intercept the
  // surrounding bare area (and skip interactive UI like menu buttons).
  const handleWrapperMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!editor || !editor.isEditable) return
      const target = e.target as HTMLElement
      if (target.closest('.rich-editor-body')) return
      if (target.closest('button, a, input, label, [contenteditable="false"]')) return
      // The global drag handle lives in the gutter (sibling of the editor body,
      // not inside it). Bail out so its native HTML5 dragstart isn't cancelled.
      if (target.closest('.drag-handle, [data-drag-handle]')) return
      e.preventDefault()
      editor.commands.focus('end')
    },
    [editor]
  )

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
    <div
      className={`rich-editor relative cursor-text ${className}`}
      onMouseDown={handleWrapperMouseDown}
    >
      <EditorBubbleMenu editor={editor} />
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
  /** Disable editing (e.g. while AI is working) */
  disabled?: boolean
  /** Optional content rendered below the title */
  metadata?: React.ReactNode
  /** Forwarded to the inner RichEditor — see RichEditorProps.onAttachment. */
  onAttachment?: (attachment: Attachment) => void
  /** See RichEditorProps.foldedHeadings / onFoldedHeadingsChange. */
  foldedHeadings?: readonly string[]
  onFoldedHeadingsChange?: (folded: string[]) => void
}

export function NoteEditor({
  title = '',
  body = '',
  onTitleChange,
  onBodyChange,
  autoFocusTitle = false,
  hideFooter = false,
  disabled = false,
  metadata,
  onAttachment,
  foldedHeadings,
  onFoldedHeadingsChange,
}: NoteEditorProps) {
  const titleRef = useRef<HTMLTextAreaElement>(null)

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

  // Sync title when it changes externally (e.g. AI tool update)
  useEffect(() => {
    if (titleRef.current && document.activeElement !== titleRef.current) {
      if (titleRef.current.value !== (title ?? '')) {
        titleRef.current.value = title ?? ''
        titleRef.current.style.height = 'auto'
        titleRef.current.style.height = titleRef.current.scrollHeight + 'px'
      }
    }
  }, [title])

  return (
    <div className="note-editor w-full mx-auto pb-16">
      {/* Title */}
      <textarea
        ref={titleRef}
        className="note-title w-full text-[2.5rem] font-bold leading-tight bg-transparent border-none outline-none resize-none overflow-hidden text-foreground placeholder:text-muted-foreground/40"
        placeholder="Note title"
        defaultValue={title}
        onInput={handleTitleInput}
        onKeyDown={handleTitleKeyDown}
        autoFocus={autoFocusTitle}
        rows={1}
        disabled={disabled}
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
      />

      {metadata}

      {/* Body — the pl-10 reserves room for the drag-handle + plus gutter. */}
      <div className="mt-6">
        <RichEditor
          content={body}
          onChange={onBodyChange}
          editable={!disabled}
          autoFocus={autoFocusTitle ? false : 'start'}
          hideFooter={hideFooter}
          onAttachment={onAttachment}
          foldedHeadings={foldedHeadings}
          onFoldedHeadingsChange={onFoldedHeadingsChange}
        />
      </div>
    </div>
  )
}
