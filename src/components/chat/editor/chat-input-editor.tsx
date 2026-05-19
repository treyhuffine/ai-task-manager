'use client';

/**
 * Shared chat-input editor used by both the execution composer and the
 * orchestrator chat. Tiptap-based so we get inline `FileChip` atoms
 * that flow with typed text — Conductor-style. The editor is text-only
 * (paragraph + text + hardBreak) plus the chip node; no headings,
 * lists, marks, etc. The composer is a single utterance, not a doc.
 *
 * Files attached to a message use the same generic attachment system
 * the rest of the app uses (tasks/notes/areas):
 *
 *   - Long pastes are converted to `.txt` files and uploaded via
 *     `POST /api/attachments` → bytes land in
 *     `<brain>/attachments/<file_name>`.
 *   - Images / files dropped onto the editor are uploaded the same
 *     way.
 *   - Each successful upload returns an `Attachment` record
 *     (`{file_name, original_name, mime_type, size, uploaded_at}`)
 *     which becomes the chip node's attrs. No separate marker id —
 *     `file_name` is the stable key.
 *
 * Two output formats are exported via the imperative ref:
 *   - `getMarkerOutput()` — for execution chat. Returns
 *     `{ text: "with [[file:<file_name>]] markers", attachments: [...] }`.
 *     The server resolves markers to absolute paths before dispatching.
 *   - `getUiMessageParts()` — for orchestrator chat. Returns an
 *     ai-sdk `parts: [{type:'text',...}, {type:'file',...}]` array in
 *     document order so the chat model sees the same structure as
 *     today, just with chip-position fidelity. File parts carry the
 *     HTTP attachment URL so the model and re-render both fetch via
 *     the standard serve route.
 *
 * Voice transcripts insert at the current selection via
 * `insertTextAtCursor`. Auto-grow is native to contenteditable; the
 * caller wraps the editor with maxHeight + overflow-y-auto.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import type { FileUIPart } from 'ai';
import { uuidv7 } from 'uuidv7';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { uploadAttachment } from '@/lib/attachments/client';
import { attachmentUrl } from '@/lib/attachments/view';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import type { Attachment } from '@/db/types';
import { FileChipNode, FILE_CHIP_NAME, type FileChipAttrs } from './file-chip-node';
import { SlashMenuExtension } from './slash-menu/extension';
import type { SkillCommandDescriptor } from './slash-menu/types';
import { MentionMenuExtension } from './mention-menu/extension';
import type { MentionItem } from './mention-menu/types';
import {
  MentionChipNode,
  MENTION_CHIP_NAME,
  type MentionChipAttrs,
} from './mention-menu/mention-chip-node';
import { PrMenuExtension } from './pr-menu/extension';
import type { PrMentionItem } from './pr-menu/types';
import { PrChipNode, PR_CHIP_NAME, type PrChipAttrs } from './pr-menu/pr-chip-node';
import { formatPrRef } from './pr-menu/expand';

// ─── Public types ────────────────────────────────────────────────

/**
 * Opaque carrier for a paused editor state. The composer captures one
 * of these before an optimistic clear-on-send and replays it via
 * `restore` if the network round-trip fails. Internally the JSON is
 * ProseMirror's `Node#toJSON()` output; we keep it as `unknown` at
 * the public surface so callers don't accidentally try to mutate it.
 */
export interface EditorSnapshot {
  readonly doc: unknown;
}

export interface ChatInputEditorHandle {
  /** True when the editor has anything submittable (text or a chip). */
  isEmpty(): boolean;
  /** Current plain text length (chips don't count). */
  textLength(): number;
  /** Move focus into the editor. */
  focus(opts?: { end?: boolean }): void;
  /** Drop content + reset history. */
  clear(): void;
  /** Insert raw text at the current selection. */
  insertTextAtCursor(text: string): void;
  /**
   * Capture the current document shape (text + chips + selection) as
   * an opaque snapshot that `restore` can replay. Used by the
   * composer to clear the editor optimistically on send, then put
   * everything back exactly as it was if the POST fails.
   *
   * Returns `null` when the editor isn't mounted yet, or when the
   * editor is empty (no work to do).
   */
  snapshot(): EditorSnapshot | null;
  /** Replace the editor's contents with a previously captured snapshot. */
  restore(snapshot: EditorSnapshot): void;
  /**
   * Upload a file (or blob) and insert a chip at the cursor. Same path
   * used by paste/drop handlers — exposed so toolbars can drive it
   * from a paperclip / camera button. Resolves once the chip is
   * inserted, or rejects with the upload error.
   */
  uploadFile(file: File | Blob, name?: string): Promise<void>;
  /**
   * Execution-chat output: a single text string with `[[file:<file_name>]]`
   * markers where chips were, plus the attachments referenced. The server
   * resolves the markers into absolute disk paths before dispatching.
   */
  getMarkerOutput(): { text: string; attachments: Attachment[] };
  /**
   * Orchestrator-chat output: ai-sdk parts in document order. Text
   * runs and chip atoms interleave so a sentence like
   * `look at [chip] please` survives intact through both the model
   * input and the UI re-render. File parts use the HTTP attachment
   * URL so the model and the renderer share the same fetch path.
   */
  getUiMessageParts(): { parts: Array<{ type: 'text'; text: string } | FileUIPart> };
}

interface ChatInputEditorProps {
  placeholder?: string;
  disabled?: boolean;
  /**
   * Called whenever the editor content changes. Lets the parent toggle
   * Send button enabled/disabled. The boolean is "is there anything
   * the user could submit?" (text OR chips).
   */
  onContentChange?: (hasContent: boolean) => void;
  /** Called when the user hits Enter (without Shift). */
  onSubmit?: () => void;
  /** Called for any unhandled Backspace-on-empty (parent may want to react). */
  onBackspaceOnEmpty?: () => void;
  /** Optional toast hook for upload errors. Defaults to console.error. */
  onUploadError?: (err: Error) => void;
  /**
   * Called the first time the editor receives focus per mount. The
   * execution composer uses this to mark the session read on
   * interaction — opening the chat no longer marks it read on its own;
   * the user has to actually engage with the textarea.
   */
  onFocus?: () => void;
  className?: string;
  /**
   * Optional slash-command descriptors surfaced via `/`. When provided
   * and non-empty, registers the SlashMenu extension. When omitted, the
   * editor behaves like a plain composer with no popup. The data
   * source is `useSlashCommands(sessionId)` on the consumer side.
   */
  slashCommands?: SkillCommandDescriptor[];
  /**
   * Optional worktree files/folders for the `@`-mention menu. Sourced
   * from `useSessionTree` on the consumer side. When omitted, typing
   * `@` does nothing special.
   */
  mentionEntries?: MentionItem[];
  /**
   * Optional PRs for the `#`-mention menu. Sourced from `usePrList`
   * on the consumer side. When omitted, typing `#` does nothing
   * special.
   */
  prs?: PrMentionItem[];
}

// ─── Tunables ──────────────────────────────────────────────────
//
// Long pastes get auto-converted to `.txt` attachments rather than
// dumped raw into the textarea. Tuned to match what most AI chat apps
// do — long enough that small snippets stay inline, short enough that
// a stack trace or log dump becomes a chip.

const PASTE_AS_FILE_CHAR_THRESHOLD = 1500;
const PASTE_AS_FILE_LINE_THRESHOLD = 30;

function shouldChipText(text: string): boolean {
  if (!text) return false;
  if (text.length > PASTE_AS_FILE_CHAR_THRESHOLD) return true;
  let nl = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      nl++;
      if (nl >= PASTE_AS_FILE_LINE_THRESHOLD) return true;
    }
  }
  return false;
}

function looksLikeMarkdown(text: string): boolean {
  return /^#{1,6} |^[-*]\s|```/m.test(text);
}

function makePastedFilename(text: string): string {
  // Match Conductor's default convention. Local time is fine — this
  // string is purely cosmetic (the file_name is the stable key).
  const now = new Date();
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const ext = looksLikeMarkdown(text) ? 'md' : 'txt';
  return `pasted_text_${stamp}.${ext}`;
}

// ─── Internal: paste / drop handlers ───────────────────────────

/**
 * ProseMirror plugin that intercepts the browser paste event. Long
 * text pastes get uploaded as `.txt` files and inserted as chip
 * atoms; short pastes fall through to Tiptap's default plain-text
 * handling.
 */
function buildPasteHandler(uploadAndInsert: (file: File | Blob, name: string) => Promise<void>) {
  return Extension.create({
    name: 'chatPasteHandler',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handlePaste(_view, event) {
              // Real files (image clipboard, drag-from-Finder, etc) take
              // precedence over the text/plain interpretation.
              const items = event.clipboardData?.items;
              if (items) {
                for (const item of Array.from(items)) {
                  if (item.kind !== 'file') continue;
                  const file = item.getAsFile();
                  if (!file) continue;
                  event.preventDefault();
                  void uploadAndInsert(file, file.name);
                  return true;
                }
              }
              const text = event.clipboardData?.getData('text/plain') ?? '';
              if (!shouldChipText(text)) return false; // let Tiptap paste plain text
              event.preventDefault();
              const filename = makePastedFilename(text);
              const blob = new Blob([text], {
                type: looksLikeMarkdown(text) ? 'text/markdown' : 'text/plain',
              });
              void uploadAndInsert(blob, filename);
              return true;
            },
            handleDrop(_view, event) {
              const dt = (event as DragEvent).dataTransfer;
              const files = dt?.files;
              if (!files || files.length === 0) return false;
              event.preventDefault();
              for (const file of Array.from(files)) {
                void uploadAndInsert(file, file.name);
              }
              return true;
            },
          },
        }),
      ];
    },
  });
}

// ─── Component ───────────────────────────────────────────────────

export const ChatInputEditor = forwardRef<ChatInputEditorHandle, ChatInputEditorProps>(
  function ChatInputEditor(
    {
      placeholder,
      disabled,
      onContentChange,
      onSubmit,
      onBackspaceOnEmpty,
      onUploadError,
      onFocus,
      className,
      slashCommands,
      mentionEntries,
      prs,
    },
    ref,
  ) {
    const onSubmitRef = useRef(onSubmit);
    onSubmitRef.current = onSubmit;
    const onBackspaceRef = useRef(onBackspaceOnEmpty);
    onBackspaceRef.current = onBackspaceOnEmpty;
    const onUploadErrorRef = useRef(onUploadError);
    onUploadErrorRef.current = onUploadError;
    const onFocusRef = useRef(onFocus);
    // Mirror slashCommands in a ref so the suggestion extension's
    // closure always reads the latest list without re-creating the
    // editor when TanStack Query refreshes the data.
    const slashCommandsRef = useRef(slashCommands);
    slashCommandsRef.current = slashCommands;
    const mentionEntriesRef = useRef(mentionEntries);
    mentionEntriesRef.current = mentionEntries;
    const prsRef = useRef(prs);
    prsRef.current = prs;
    onFocusRef.current = onFocus;

    const KeymapExtension = useMemo(
      () =>
        Extension.create({
          name: 'chatInputKeymap',
          addKeyboardShortcuts() {
            return {
              Enter: () => {
                onSubmitRef.current?.();
                return true;
              },
              'Shift-Enter': () => this.editor.commands.setHardBreak(),
              'Mod-Enter': () => {
                onSubmitRef.current?.();
                return true;
              },
              Backspace: () => {
                if (!this.editor.isEmpty) return false;
                onBackspaceRef.current?.();
                return false;
              },
            };
          },
        }),
      [],
    );

    // Editor handle is captured at construction; uploadAndInsert needs
    // to read the latest editor instance to call commands on it.
    const editorRef = useRef<Editor | null>(null);

    /**
     * Core upload path. Inserts a pending placeholder chip with a
     * spinner immediately so the user sees the file land where they
     * dropped/pasted. When the upload resolves, we walk the doc to
     * find the placeholder by `pending_id` and swap in the real
     * Attachment attrs. On failure, we remove the placeholder.
     *
     * Throws on failure so the imperative `uploadFile` handle can
     * surface errors; the paste/drop wrappers use
     * `uploadAndInsertSafe` below which toasts and swallows.
     */
    const uploadAndInsert = useMemo(
      () => async (file: File | Blob, name: string) => {
        const ed = editorRef.current;
        if (!ed) return;
        const pendingId = uuidv7();
        const fileSize = 'size' in file ? file.size : 0;
        const fileMime = file instanceof File && file.type ? file.type : 'application/octet-stream';

        ed.commands.insertFileChip({
          file_name: '',
          original_name: name,
          mime_type: fileMime,
          size: fileSize,
          uploaded_at: '',
          pending: true,
          pending_id: pendingId,
        });

        try {
          const att = await uploadAttachment(file, name);
          replacePendingChip(ed, pendingId, att);
        } catch (err) {
          removePendingChip(ed, pendingId);
          throw err;
        }
      },
      [],
    );

    const uploadAndInsertSafe = useMemo(
      () => async (file: File | Blob, name: string) => {
        try {
          await uploadAndInsert(file, name);
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          if (onUploadErrorRef.current) {
            onUploadErrorRef.current(e);
          } else {
            // Sonner is mounted at the layout root; safe to call from
            // anywhere. Truncate name in case it's a long pasted text
            // filename like `pasted_text_2026-05-11-...`.
            const shortName = name.length > 40 ? `${name.slice(0, 37)}…` : name;
            toast.error(`Couldn't attach ${shortName}`, { description: e.message });
          }
        }
      },
      [uploadAndInsert],
    );

    const PasteDropExtension = useMemo(
      () => buildPasteHandler(uploadAndInsertSafe),
      [uploadAndInsertSafe],
    );

    const editor = useEditor({
      // contenteditable doesn't render server-side; defer the editor
      // until the client takes over, otherwise React 19 hydration
      // mismatches and Tiptap's older "editor not yet immediately
      // rendered" warning both fire.
      immediatelyRender: false,
      extensions: [
        // StarterKit gives document/paragraph/text/hardBreak/history
        // for free — disable everything else so this stays a tiny
        // single-utterance editor (no headings, lists, marks, etc).
        StarterKit.configure({
          heading: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
          bold: false,
          italic: false,
          strike: false,
          code: false,
        }),
        Placeholder.configure({ placeholder: placeholder ?? '' }),
        FileChipNode,
        PrChipNode,
        MentionChipNode,
        PasteDropExtension,
        SlashMenuExtension.configure({
          getCommands: () => slashCommandsRef.current ?? [],
        }),
        MentionMenuExtension.configure({
          getEntries: () => mentionEntriesRef.current ?? [],
        }),
        PrMenuExtension.configure({
          getPrs: () => prsRef.current ?? [],
        }),
        KeymapExtension,
      ],
      editorProps: {
        attributes: {
          class: cn(
            'outline-none text-[13px] text-foreground leading-snug',
            'min-h-[20px] max-h-[200px] overflow-y-auto',
            'px-3 pt-2.5 pb-2 break-words',
          ),
          'aria-label': placeholder ?? 'Message',
        },
      },
      editable: !disabled,
      onUpdate({ editor }) {
        onContentChange?.(!editor.isEmpty);
      },
      onFocus() {
        onFocusRef.current?.();
      },
    });

    editorRef.current = editor;

    useEffect(() => {
      if (!editor) return;
      editor.setEditable(!disabled);
    }, [editor, disabled]);

    // Global hotkey focuses the chat input. Only one ChatInputEditor is
    // ever mounted (orchestrator vs. executor views are mutually
    // exclusive), so a window-level listener is unambiguous. Skip when
    // focus is in another rich editor (note/task body) so the user's
    // italic shortcut still works there — plain inputs/textareas don't
    // bind Cmd+I, so it's safe to steal from those.
    useEffect(() => {
      if (!editor) return;
      const handler = (e: KeyboardEvent) => {
        if (!matchesHotkey(e, HOTKEYS.focusChatInput)) return;
        const target = e.target;
        if (target instanceof HTMLElement) {
          const ce = target.closest('[contenteditable="true"]');
          if (ce && !editor.view.dom.contains(target)) return;
        }
        e.preventDefault();
        editor.chain().focus('end').run();
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, [editor]);

    useImperativeHandle(
      ref,
      (): ChatInputEditorHandle => ({
        isEmpty: () => editor?.isEmpty ?? true,
        textLength: () => (editor ? editor.state.doc.textContent.length : 0),
        focus: (opts) => {
          if (!editor) return;
          editor
            .chain()
            .focus(opts?.end ? 'end' : undefined)
            .run();
        },
        clear: () => {
          if (!editor) return;
          editor.commands.clearContent(true);
        },
        insertTextAtCursor: (text) => {
          if (!editor) return;
          editor.chain().focus().insertContent(text).run();
        },
        snapshot: () => {
          if (!editor || editor.isEmpty) return null;
          return { doc: editor.getJSON() };
        },
        restore: (snap) => {
          if (!editor) return;
          // `setContent` with `emitUpdate: true` so `onUpdate` runs and
          // the parent's `hasContent` flips back to true after a
          // failed-send rollback. Focus to the end matches what the
          // editor was at right before send (typing position).
          editor.chain().setContent(snap.doc as never, { emitUpdate: true }).focus('end').run();
        },
        uploadFile: (file, name) => uploadAndInsert(file, name ?? (file as File).name ?? 'upload'),
        getMarkerOutput: () => buildMarkerOutput(editor),
        getUiMessageParts: () => buildUiMessageParts(editor),
      }),
      [editor, uploadAndInsert],
    );

    return (
      <EditorContent
        editor={editor}
        className={cn(
          // Tiptap renders a `.ProseMirror` div inside; we let its
          // editorProps.attributes carry the layout classes so the
          // wrapper here is just a positioning shell.
          'flex-1 min-w-0',
          // Style placeholder via the extension's `is-editor-empty`
          // class. Otherwise placeholder bleeds into the chip when an
          // attachment exists with no typed text.
          '[&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
          '[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground/50',
          '[&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left',
          '[&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none',
          '[&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0',
          className,
        )}
      />
    );
  },
);

// ─── Pending-chip helpers ────────────────────────────────────────
//
// Walk the doc to find a chip with the given `pending_id` (set at
// insert time). Swap its attrs to the real Attachment on success, or
// delete it on failure. Tiptap's transactional API gives us atomic
// updates — no flicker, no orphan chips on race.

function findPendingChip(editor: Editor, pendingId: string): { pos: number; size: number } | null {
  let found: { pos: number; size: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name !== FILE_CHIP_NAME) return true;
    if ((node.attrs as FileChipAttrs).pending_id === pendingId) {
      found = { pos, size: node.nodeSize };
      return false;
    }
    return true;
  });
  return found;
}

function replacePendingChip(editor: Editor, pendingId: string, attachment: Attachment): void {
  const hit = findPendingChip(editor, pendingId);
  if (!hit) return;
  const tr = editor.state.tr.setNodeMarkup(hit.pos, undefined, {
    ...attachment,
    pending: false,
    pending_id: '',
  } as FileChipAttrs);
  editor.view.dispatch(tr);
}

function removePendingChip(editor: Editor, pendingId: string): void {
  const hit = findPendingChip(editor, pendingId);
  if (!hit) return;
  const tr = editor.state.tr.delete(hit.pos, hit.pos + hit.size);
  editor.view.dispatch(tr);
}

// ─── Output builders ─────────────────────────────────────────────

function buildMarkerOutput(editor: Editor | null): { text: string; attachments: Attachment[] } {
  if (!editor) return { text: '', attachments: [] };
  const seenFileNames = new Set<string>();
  const attachments: Attachment[] = [];
  const lines: string[] = [];

  editor.state.doc.descendants((node) => {
    if (node.type.name === FILE_CHIP_NAME) {
      const attrs = node.attrs as FileChipAttrs;
      // Skip chips that are still uploading. Caller is expected to
      // disable Send while any chip is pending, but if a race slips
      // through (Enter pressed during the upload roundtrip), we'd
      // rather drop the placeholder than ship an empty file_name.
      if (attrs.pending || !attrs.file_name) return false;
      if (!seenFileNames.has(attrs.file_name)) {
        seenFileNames.add(attrs.file_name);
        const { pending: _p, pending_id: _pid, ...persisted } = attrs;
        attachments.push(persisted);
      }
      // Marker token uses a double-bracket prefix so it doesn't collide
      // with real bracketed text the user might type. file_name is
      // `<uuidv7>.<ext>` — safe in a regex character class.
      lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + `[[file:${attrs.file_name}]]`;
      return false;
    }
    if (node.type.name === PR_CHIP_NAME) {
      // PR chips self-serialize to the same expanded text the manual
      // `#193` typing path produces via `expandPrRefs`. Doing it here
      // means the chip is self-contained — no dependency on the PR
      // list cache being fresh at send time.
      const attrs = node.attrs as PrChipAttrs;
      lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + formatPrRef(attrs);
      return false;
    }
    if (node.type.name === MENTION_CHIP_NAME) {
      // File/folder chips emit `@<relative-path>` — same wire format
      // the manual `@<path>` typing path uses, so the agent sees one
      // canonical shape regardless of how the user composed it.
      const attrs = node.attrs as MentionChipAttrs;
      if (attrs.path) {
        lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + `@${attrs.path}`;
      }
      return false;
    }
    if (node.type.name === 'paragraph') {
      lines.push('');
      return true;
    }
    if (node.isText) {
      lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + (node.text ?? '');
      return false;
    }
    if (node.type.name === 'hardBreak') {
      lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + '\n';
      return false;
    }
    return true;
  });

  // Drop the leading empty if the doc started with a paragraph (Tiptap
  // always wraps in one).
  while (lines.length && lines[0] === '') lines.shift();

  return { text: lines.join('\n').trim(), attachments };
}

function buildUiMessageParts(editor: Editor | null): {
  parts: Array<{ type: 'text'; text: string } | FileUIPart>;
} {
  if (!editor) return { parts: [] };
  const parts: Array<{ type: 'text'; text: string } | FileUIPart> = [];
  let textBuf = '';

  const flushText = () => {
    if (textBuf.length > 0) {
      parts.push({ type: 'text', text: textBuf });
      textBuf = '';
    }
  };

  editor.state.doc.descendants((node) => {
    if (node.type.name === FILE_CHIP_NAME) {
      // Flush any pending text run, then push the chip's file part
      // immediately after — preserving the position the user pasted.
      flushText();
      const attrs = node.attrs as FileChipAttrs;
      // Skip pending chips — same rationale as buildMarkerOutput.
      if (attrs.pending || !attrs.file_name) return false;
      parts.push({
        type: 'file',
        mediaType: attrs.mime_type,
        filename: attrs.original_name || attrs.file_name,
        url: attachmentUrl(attrs.file_name),
      });
      return false;
    }
    if (node.type.name === PR_CHIP_NAME) {
      // PR chips inline as expanded text — the orchestrator chat model
      // doesn't have a native PR part type, so we surface the context
      // as a text run that flows with the surrounding sentence.
      const attrs = node.attrs as PrChipAttrs;
      textBuf += formatPrRef(attrs);
      return false;
    }
    if (node.type.name === MENTION_CHIP_NAME) {
      // File/folder chips inline as `@<path>` text — the path itself
      // is the canonical reference the agent acts on.
      const attrs = node.attrs as MentionChipAttrs;
      if (attrs.path) textBuf += `@${attrs.path}`;
      return false;
    }
    if (node.type.name === 'paragraph') {
      // Tiptap wraps content in paragraph nodes. Add a newline between
      // paragraphs so multi-paragraph text reads naturally.
      if (textBuf.length > 0 && !textBuf.endsWith('\n')) textBuf += '\n';
      return true;
    }
    if (node.isText) {
      textBuf += node.text ?? '';
      return false;
    }
    if (node.type.name === 'hardBreak') {
      textBuf += '\n';
      return false;
    }
    return true;
  });

  flushText();

  // Trim trailing/leading whitespace on the very first/last text part
  // so the message doesn't ship with an opening newline from Tiptap's
  // outer paragraph wrapper.
  if (parts.length > 0) {
    const first = parts[0];
    if (first?.type === 'text') first.text = first.text.replace(/^\n+/, '');
    const last = parts[parts.length - 1];
    if (last?.type === 'text') last.text = last.text.replace(/\n+$/, '');
    // Drop any all-empty text parts that survived the trim.
    return { parts: parts.filter((p) => p.type !== 'text' || p.text.length > 0) };
  }

  return { parts };
}
