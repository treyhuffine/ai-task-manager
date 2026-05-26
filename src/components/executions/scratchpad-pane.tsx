'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { X, Notebook, NotebookPen, Plus, Loader2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hot } from '@/lib/_debug/hot-path';
import { useScratchpad, useSetScratchpad } from '@/hooks/use-execution';
import { api } from '@/lib/api/client';

interface ScratchpadPaneProps {
  sessionId: string;
  workspaceId: string | null;
  open: boolean;
  onClose: () => void;
  /** Insert raw text into the composer (used by "Send to chat"). */
  onInsertText: (text: string) => void;
  /** Insert a task / note chip into the composer (used by Promote). */
  onInsertChip: (attrs: { kind: 'task' | 'note'; id: string; title: string }) => void;
}

const SAVE_DEBOUNCE_MS = 500;

/**
 * The 📝-button slide-over. Single Tiptap editor over the viewer
 * column, auto-saves on debounce. The body is plain markdown text in
 * the DB; we render it via StarterKit with a placeholder. Promote /
 * Send-to-chat selection actions live in a thin toolbar above the
 * editor (visible whenever the user has a non-empty selection).
 *
 * Mounting is gated on `open` so the editor doesn't pay its setup cost
 * when nothing's visible.
 */
export function ScratchpadPane({
  sessionId,
  workspaceId,
  open,
  onClose,
  onInsertText,
  onInsertChip,
}: ScratchpadPaneProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="flex flex-col h-full w-full bg-background border-l border-border shadow-xl"
      role="dialog"
      aria-label="Scratchpad"
    >
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        <NotebookPen size={12} className="text-muted-foreground/80" />
        <span className="text-[12px] font-semibold text-foreground">Scratchpad</span>
        <span className="text-[10.5px] text-muted-foreground/70">
          for this session
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="Close scratchpad"
          title="Close (Esc)"
        >
          <X size={13} />
        </button>
      </div>
      <ScratchpadEditor
        sessionId={sessionId}
        workspaceId={workspaceId}
        onInsertText={onInsertText}
        onInsertChip={onInsertChip}
      />
    </div>
  );
}

function ScratchpadEditor({
  sessionId,
  workspaceId,
  onInsertText,
  onInsertChip,
}: {
  sessionId: string;
  workspaceId: string | null;
  onInsertText: (text: string) => void;
  onInsertChip: (attrs: { kind: 'task' | 'note'; id: string; title: string }) => void;
}) {
  const { data } = useScratchpad(sessionId);
  const setMutation = useSetScratchpad(sessionId);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string | null>(data?.scratch_pad ?? null);
  const [selectionText, setSelectionText] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        horizontalRule: false,
      }),
      Placeholder.configure({
        placeholder: 'Jot quick thoughts for this session…',
      }),
    ],
    content: data?.scratch_pad ?? '',
    editorProps: {
      attributes: {
        class: cn(
          'outline-none text-[12.5px] text-foreground leading-relaxed',
          'min-h-full px-4 pt-3 pb-6 break-words',
          'prose prose-sm dark:prose-invert max-w-none',
          '[&_p]:my-1.5 [&_ul]:my-1 [&_ol]:my-1',
        ),
        'aria-label': 'Scratchpad editor',
      },
    },
    onUpdate({ editor }) {
      hot('editor onUpdate Scratchpad');
      const text = editor.getText();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setStatus('saving');
      saveTimerRef.current = setTimeout(() => {
        if (text === lastSavedRef.current) {
          setStatus('idle');
          return;
        }
        lastSavedRef.current = text;
        setMutation.mutate(text.length === 0 ? null : text, {
          onSuccess: () => setStatus('saved'),
          onError: () => setStatus('idle'),
        });
      }, SAVE_DEBOUNCE_MS);
    },
    onSelectionUpdate({ editor }) {
      const { from, to } = editor.state.selection;
      const sel = editor.state.doc.textBetween(from, to, '\n');
      setSelectionText(sel);
    },
  });

  // Sync server content on first load.
  useEffect(() => {
    if (!editor || data == null) return;
    if (editor.getText() === (data.scratch_pad ?? '')) return;
    if (lastSavedRef.current !== null) return; // already user-edited
    editor.commands.setContent(data.scratch_pad ?? '');
    lastSavedRef.current = data.scratch_pad ?? '';
  }, [editor, data]);

  // Autofocus once Tiptap is mounted. The pane component only mounts
  // when `open` flips true (parent renders null otherwise), so this
  // fires exactly once per open and drops the user straight into the
  // editor — no manual click required.
  useEffect(() => {
    if (!editor) return;
    const t = setTimeout(() => editor.commands.focus('end'), 0);
    return () => clearTimeout(t);
  }, [editor]);

  // Click anywhere inside the editor surface focuses Tiptap. Without
  // this, clicks below the last text line (in the empty padding area)
  // wouldn't register — the user had to land on an actual line of
  // text or the slim padded strip around it.
  const handleSurfaceClick = () => {
    if (editor && !editor.isFocused) editor.commands.focus('end');
  };

  // Flush on unmount in case the debounce hadn't fired.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const hasSelection = selectionText.trim().length > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PromotionBar
        sessionId={sessionId}
        workspaceId={workspaceId}
        selectionText={selectionText}
        hasSelection={hasSelection}
        onInsertText={onInsertText}
        onInsertChip={onInsertChip}
      />
      {/* The whole surface is the click target so users can land
          anywhere — including the empty space below the last line —
          and start typing. `cursor-text` reinforces the affordance.
          Tiptap's `is-editor-empty` selector drives the placeholder
          render; the rules below mirror chat-input-editor.tsx so an
          empty scratchpad shows the placeholder prompt rather than an
          invisible void. */}
      <div
        className={cn(
          'flex-1 min-h-0 overflow-y-auto cursor-text',
          '[&_.ProseMirror]:min-h-full',
          '[&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
          '[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground/50',
          '[&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left',
          '[&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none',
          '[&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0',
        )}
        onClick={handleSurfaceClick}
      >
        <EditorContent editor={editor} />
      </div>
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-1 border-t border-border text-[10px] text-muted-foreground/60">
        <span>
          {status === 'saving' ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={9} className="animate-spin" />
              Saving…
            </span>
          ) : status === 'saved' ? (
            'Saved'
          ) : (
            'Auto-saves while you type'
          )}
        </span>
        <span>@scratchpad to reference in chat</span>
      </div>
    </div>
  );
}

function PromotionBar({
  sessionId,
  workspaceId,
  selectionText,
  hasSelection,
  onInsertText,
  onInsertChip,
}: {
  sessionId: string;
  workspaceId: string | null;
  selectionText: string;
  hasSelection: boolean;
  onInsertText: (text: string) => void;
  onInsertChip: (attrs: { kind: 'task' | 'note'; id: string; title: string }) => void;
}) {
  const qc = useQueryClient();
  const [pendingKind, setPendingKind] = useState<'task' | 'note' | null>(null);

  const promoteMutation = useMutation({
    mutationFn: async (input: { kind: 'task' | 'note'; text: string }) => {
      if (input.kind === 'task') {
        const firstLine = input.text.split('\n')[0]?.trim() ?? '';
        const title = firstLine.length > 0 ? firstLine.slice(0, 200) : 'Untitled task';
        return api.post<{ id: string; title: string }>('/tasks', {
          title,
          body: input.text,
          workspace_id: workspaceId,
          raw_input: input.text,
        });
      }
      const firstLine = input.text.split('\n')[0]?.trim() ?? '';
      const title = firstLine.length > 0 ? firstLine.slice(0, 200) : 'Untitled note';
      return api.post<{ id: string; title: string }>('/notes', {
        title,
        body: input.text,
        workspace_id: workspaceId,
      });
    },
    onSettled: (_data, _err, _input) => {
      setPendingKind(null);
    },
    onSuccess: (created, input) => {
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'references'] });
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'picker'] });
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'entities'] });
      onInsertChip({ kind: input.kind, id: created.id, title: created.title || input.kind });
    },
  });

  const handlePromote = (kind: 'task' | 'note') => {
    if (!hasSelection || promoteMutation.isPending) return;
    setPendingKind(kind);
    promoteMutation.mutate({ kind, text: selectionText.trim() });
  };

  const handleSendToChat = () => {
    if (!hasSelection) return;
    // Insert raw selection text into the composer; not a marker —
    // pasting is the right model here so the agent reads the selection
    // directly in the next turn.
    onInsertText(selectionText.trim() + ' ');
  };

  return (
    <div
      className={cn(
        'flex-shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-border',
        'bg-muted/20',
      )}
    >
      <span className="text-[10px] text-muted-foreground/60">
        {hasSelection ? 'Selection:' : 'Select text to promote'}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          disabled={!hasSelection || promoteMutation.isPending}
          onClick={() => handlePromote('task')}
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10.5px] font-medium',
            'text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
          title="Create a task from the selection"
        >
          {pendingKind === 'task' ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Plus size={10} />
          )}
          Task
        </button>
        <button
          type="button"
          disabled={!hasSelection || promoteMutation.isPending}
          onClick={() => handlePromote('note')}
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10.5px] font-medium',
            'text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
          title="Create a note from the selection"
        >
          {pendingKind === 'note' ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Plus size={10} />
          )}
          Note
        </button>
        <button
          type="button"
          disabled={!hasSelection}
          onClick={handleSendToChat}
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10.5px] font-medium',
            'text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
          title="Insert the selected text into the composer"
        >
          <ArrowRight size={10} />
          To chat
        </button>
      </div>
    </div>
  );
}

interface ScratchpadButtonProps {
  /** True when the scratchpad pane is currently visible. */
  open?: boolean;
  /** Toggles the pane — click again to close. */
  onClick: () => void;
}

export function ScratchpadButton({ open, onClick }: ScratchpadButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!open}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md',
        'text-[11px] font-medium transition-colors flex-shrink-0',
        open
          ? 'bg-primary/15 text-primary hover:bg-primary/20'
          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      )}
      title={open ? 'Close scratchpad' : 'Scratchpad — jot thoughts for this session'}
      aria-label={open ? 'Close scratchpad' : 'Scratchpad'}
    >
      {open ? <X size={12} /> : <NotebookPen size={12} />}
      <span>{open ? 'Close' : 'Scratchpad'}</span>
    </button>
  );
}
