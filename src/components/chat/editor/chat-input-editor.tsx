'use client';

/**
 * Shared chat-input editor used by both the execution composer and the
 * orchestrator chat. Tiptap-based so we get inline `PasteChip` atoms
 * that flow with typed text — Conductor-style. The editor is text-only
 * (paragraph + text + hardBreak) plus the chip node; no headings,
 * lists, marks, etc. The composer is a single utterance, not a doc.
 *
 * Pasted content is stored two places:
 *   1. The doc holds a chip *attrs-only* placeholder ({ id, filename,
 *      size, lineCount }) at the cursor position the user pasted.
 *   2. The full pasted text lives in an editor-instance Map
 *      (`pasteContentMap`) keyed by id. We avoid putting big content
 *      on the node attrs because every keystroke would re-serialize
 *      the doc, and the SDK roundtrips attrs in plenty of internal
 *      paths.
 *
 * Two output formats are exported via the imperative ref:
 *   - `getMarkerOutput()` — for execution chat. Returns
 *     `{ text: "with [[paste:id]] markers", attachments: [...] }`. The
 *     server expands markers before dispatching to agentex.
 *   - `getUiMessageParts()` — for orchestrator chat. Returns an
 *     ai-sdk `parts: [{type:'text',...}, {type:'file',...}]` array in
 *     document order so the chat model sees the same structure as
 *     today, just with chip-position fidelity.
 *
 * Voice transcripts insert at the current selection via
 * `insertTextAtCursor`. Auto-grow is native to contenteditable; the
 * caller wraps the editor with maxHeight + overflow-y-auto.
 */

import {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef,
} from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import type { FileUIPart } from 'ai';
import { uuidv7 } from 'uuidv7';
import { cn } from '@/lib/utils';
import {
  PASTE_AS_FILE_CHAR_THRESHOLD,
  PASTE_AS_FILE_LINE_THRESHOLD,
  PASTED_TEXT_MEDIA_TYPE,
  textToDataUrl,
} from '@/lib/chat/paste-attachments';
import { PasteChipNode, PASTE_CHIP_NAME, type PasteChipAttrs } from './paste-chip-node';

// ─── Public types ────────────────────────────────────────────────

/**
 * One pasted attachment as it leaves the editor for the execution
 * server. The orchestrator path doesn't use this shape — see
 * `getUiMessageParts()` instead.
 */
export interface ChipAttachment {
  id: string;
  filename: string;
  content: string;
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
   * Execution-chat output: a single text string with `[[paste:id]]`
   * markers where chips were, plus the resolved attachment array. The
   * server expands the markers into full content before dispatching.
   */
  getMarkerOutput(): { text: string; attachments: ChipAttachment[] };
  /**
   * Orchestrator-chat output: ai-sdk parts in document order. Text
   * runs and chip atoms interleave so a sentence like
   * `look at [chip] please` survives intact through both the model
   * input and the UI re-render.
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
  className?: string;
}

// ─── Internal: paste-content storage on the editor instance ────
//
// We attach a Map<id, content> to the editor's storage so chip ids
// resolve to full content at submit time. Bypasses the doc-attribute
// path entirely — the chip atom carries only id/filename/size/lineCount.

interface PasteStorage {
  byId: Map<string, string>;
}

function getPasteStorage(editor: Editor): PasteStorage {
  return (editor.storage as unknown as Record<string, unknown>)[PASTE_CHIP_NAME] as PasteStorage;
}

const PasteStorageExtension = Extension.create<{}, PasteStorage>({
  name: PASTE_CHIP_NAME,
  addStorage() {
    return { byId: new Map<string, string>() };
  },
});

// ─── Internal: paste handler ───────────────────────────────────

/**
 * ProseMirror plugin that intercepts the browser paste event. Long
 * pastes become chip atoms; short pastes fall through to Tiptap's
 * default plain-text handling.
 */
function buildPasteHandler() {
  return Extension.create({
    name: 'chatPasteHandler',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          props: {
            handlePaste(view, event) {
              const text = event.clipboardData?.getData('text/plain') ?? '';
              if (!shouldChip(text)) return false; // let Tiptap paste plain text

              event.preventDefault();
              const id = uuidv7();
              const filename = makePastedFilename(text);
              const size = new Blob([text]).size;
              const lineCount = countLines(text);

              // Store the content out-of-band, then insert the chip at
              // the cursor.
              getPasteStorage(editor).byId.set(id, text);
              editor.commands.insertPasteChip({ id, filename, size, lineCount });
              return true;
            },
          },
        }),
      ];
    },
  });
}

function shouldChip(text: string): boolean {
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

function countLines(text: string): number {
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function makePastedFilename(text: string): string {
  // Match Conductor's default convention. Local time is fine — this
  // string is purely cosmetic (the id is the stable key).
  const now = new Date();
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  // Lightly sniff for code-ish content so the chip reads reasonably
  // even before the user reviews it.
  const ext = looksLikeMarkdown(text) ? 'md' : 'txt';
  return `pasted_text_${stamp}.${ext}`;
}

function looksLikeMarkdown(text: string): boolean {
  return /^#{1,6} |^[-*]\s|```/m.test(text);
}

// ─── Component ───────────────────────────────────────────────────

export const ChatInputEditor = forwardRef<ChatInputEditorHandle, ChatInputEditorProps>(
  function ChatInputEditor(
    { placeholder, disabled, onContentChange, onSubmit, onBackspaceOnEmpty, className },
    ref,
  ) {
    const onSubmitRef = useRef(onSubmit);
    onSubmitRef.current = onSubmit;
    const onBackspaceRef = useRef(onBackspaceOnEmpty);
    onBackspaceRef.current = onBackspaceOnEmpty;

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
        PasteChipNode,
        PasteStorageExtension,
        buildPasteHandler(),
        KeymapExtension,
      ],
      editorProps: {
        attributes: {
          class: cn(
            'outline-none text-[13px] text-foreground leading-snug',
            'min-h-[20px] max-h-[200px] overflow-y-auto',
            'px-3 pt-2.5 pb-1 break-words',
          ),
          'aria-label': placeholder ?? 'Message',
        },
      },
      editable: !disabled,
      onUpdate({ editor }) {
        onContentChange?.(!editor.isEmpty);
      },
    });

    useEffect(() => {
      if (!editor) return;
      editor.setEditable(!disabled);
    }, [editor, disabled]);

    // Note: placeholder string only takes effect at editor construction.
    // For chat composers this is fine — placeholder rarely changes
    // mid-render (it's "Message the agent…" or "Loading…").

    useImperativeHandle(
      ref,
      (): ChatInputEditorHandle => ({
        isEmpty: () => editor?.isEmpty ?? true,
        textLength: () => (editor ? editor.state.doc.textContent.length : 0),
        focus: (opts) => {
          if (!editor) return;
          editor.chain().focus(opts?.end ? 'end' : undefined).run();
        },
        clear: () => {
          if (!editor) return;
          getPasteStorage(editor).byId.clear();
          editor.commands.clearContent(true);
        },
        insertTextAtCursor: (text) => {
          if (!editor) return;
          editor.chain().focus().insertContent(text).run();
        },
        getMarkerOutput: () => buildMarkerOutput(editor),
        getUiMessageParts: () => buildUiMessageParts(editor),
      }),
      [editor],
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

// ─── Output builders ─────────────────────────────────────────────

function buildMarkerOutput(editor: Editor | null): { text: string; attachments: ChipAttachment[] } {
  if (!editor) return { text: '', attachments: [] };
  const storage = getPasteStorage(editor);
  const seenIds = new Set<string>();
  const attachments: ChipAttachment[] = [];
  const lines: string[] = [];

  editor.state.doc.descendants((node) => {
    if (node.type.name === PASTE_CHIP_NAME) {
      const attrs = node.attrs as PasteChipAttrs;
      const content = storage.byId.get(attrs.id);
      if (content && !seenIds.has(attrs.id)) {
        seenIds.add(attrs.id);
        attachments.push({ id: attrs.id, filename: attrs.filename, content });
      }
      // Marker token uses a double-bracket UUID prefix so it doesn't
      // collide with real bracketed text the user might type.
      lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + `[[paste:${attrs.id}]]`;
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

function buildUiMessageParts(
  editor: Editor | null,
): { parts: Array<{ type: 'text'; text: string } | FileUIPart> } {
  if (!editor) return { parts: [] };
  const storage = getPasteStorage(editor);
  const parts: Array<{ type: 'text'; text: string } | FileUIPart> = [];
  let textBuf = '';

  const flushText = () => {
    if (textBuf.length > 0) {
      parts.push({ type: 'text', text: textBuf });
      textBuf = '';
    }
  };

  editor.state.doc.descendants((node) => {
    if (node.type.name === PASTE_CHIP_NAME) {
      // Flush any pending text run, then push the chip's file part
      // immediately after — preserving the position the user pasted.
      flushText();
      const attrs = node.attrs as PasteChipAttrs;
      const content = storage.byId.get(attrs.id);
      if (content) {
        parts.push({
          type: 'file',
          mediaType: PASTED_TEXT_MEDIA_TYPE,
          filename: attrs.filename,
          url: textToDataUrl(content),
        });
      }
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
