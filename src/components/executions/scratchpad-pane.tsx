'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import { Plus, Loader2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hot } from '@/lib/_debug/hot-path';
import { useScratchpad, useSetScratchpad } from '@/hooks/use-execution';
import { api } from '@/lib/api/client';

interface ScratchpadPaneProps {
  sessionId: string;
  workspaceId: string | null;
  /** Insert raw text into the composer (used by "Send to chat"). */
  onInsertText: (text: string) => void;
  /** Insert a task / note chip into the composer (used by Promote). */
  onInsertChip: (attrs: { kind: 'task' | 'note'; id: string; title: string }) => void;
  /**
   * Drop the caret into the editor on mount. True when the user just opened
   * the scratchpad, false when the panel restored it on load, so a restore
   * never steals focus from the message box.
   */
  autoFocus?: boolean;
}

const SAVE_DEBOUNCE_MS = 500;

/**
 * The Scratchpad view in the execution workbench panel. A private draft
 * space for one chat (it's stored per chat), so the panel names the chat
 * it belongs to. Single Tiptap editor, auto-saves on debounce. The body is Markdown text in the DB,
 * round-tripped through the @tiptap/markdown extension (getMarkdown on
 * save, markdown.parse on load) so multi-line notes survive a remount —
 * reloading the stored string as HTML collapsed every newline into one
 * block. Promote / Send-to-chat selection actions live in a thin toolbar
 * above the editor (visible whenever the user has a non-empty selection).
 *
 * The panel owns the chrome (tab, close, expand), so this just fills its
 * container.
 */
export function ScratchpadPane({
  sessionId,
  workspaceId,
  onInsertText,
  onInsertChip,
  autoFocus = false,
}: ScratchpadPaneProps) {
  return (
    <div className="flex flex-col h-full w-full bg-background" aria-label="Scratchpad">
      <ScratchpadEditor
        // A different chat is a different scratchpad: remount so the editor
        // loads that chat's text instead of carrying the last one's.
        key={sessionId}
        sessionId={sessionId}
        workspaceId={workspaceId}
        onInsertText={onInsertText}
        onInsertChip={onInsertChip}
        autoFocus={autoFocus}
      />
    </div>
  );
}

function ScratchpadEditor({
  sessionId,
  workspaceId,
  onInsertText,
  onInsertChip,
  autoFocus,
}: {
  sessionId: string;
  workspaceId: string | null;
  onInsertText: (text: string) => void;
  onInsertChip: (attrs: { kind: 'task' | 'note'; id: string; title: string }) => void;
  autoFocus: boolean;
}) {
  const { data } = useScratchpad(sessionId);
  const setMutation = useSetScratchpad(sessionId);
  const setMutationRef = useRef(setMutation);
  useEffect(() => {
    setMutationRef.current = setMutation;
  });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The text waiting on the debounce, so an unmount (a tab switch, closing
  // the panel) can still save it instead of dropping the last keystrokes.
  const pendingTextRef = useRef<string | null>(null);
  const lastSavedRef = useRef<string | null>(data?.scratchPad ?? null);
  const [selectionText, setSelectionText] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        horizontalRule: false,
      }),
      // Serialize/parse the body as Markdown, matching rich-editor.tsx.
      // Enables editor.getMarkdown() on save and editor.markdown.parse()
      // on load so paragraph breaks round-trip instead of collapsing.
      Markdown,
      Placeholder.configure({
        placeholder: 'Jot thoughts for this chat. Nothing is sent until you choose to.',
      }),
    ],
    content: data?.scratchPad ?? '',
    // Parse the stored string as Markdown, not HTML — otherwise Tiptap
    // treats a bare string as HTML and collapses its newlines. Only
    // meaningful when there's initial content at creation time.
    ...(data?.scratchPad ? { contentType: 'markdown' as const } : {}),
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
      const text = editor.getMarkdown();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setStatus('saving');
      pendingTextRef.current = text;
      saveTimerRef.current = setTimeout(() => {
        pendingTextRef.current = null;
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

  // Sync server content on first load. The stored value is Markdown, so
  // parse it as Markdown (not HTML) before setting it — reloading a bare
  // string collapses its newlines into a single block. Compare against
  // the editor's own Markdown so the "already in sync" guard stays honest.
  useEffect(() => {
    if (!editor || data == null) return;
    const stored = data.scratchPad ?? '';
    const currentMd = editor.getMarkdown();
    if (currentMd === stored) return;
    if (lastSavedRef.current !== null) return; // already user-edited
    const json = editor.markdown?.parse(stored);
    if (json) editor.commands.setContent(json, { emitUpdate: false });
    lastSavedRef.current = stored;
  }, [editor, data]);

  // Autofocus once Tiptap is mounted, when the user just opened the
  // scratchpad. A restored panel leaves focus where it was.
  useEffect(() => {
    if (!editor || !autoFocus) return;
    const t = setTimeout(() => editor.commands.focus('end'), 0);
    return () => clearTimeout(t);
  }, [editor, autoFocus]);

  // Click anywhere inside the editor surface focuses Tiptap. Without
  // this, clicks below the last text line (in the empty padding area)
  // wouldn't register — the user had to land on an actual line of
  // text or the slim padded strip around it.
  const handleSurfaceClick = () => {
    if (editor && !editor.isFocused) editor.commands.focus('end');
  };

  // Flush on unmount in case the debounce hadn't fired. Switching tabs or
  // closing the panel unmounts the editor, so without this the last half
  // second of typing would be lost.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const pending = pendingTextRef.current;
      if (pending !== null && pending !== lastSavedRef.current) {
        lastSavedRef.current = pending;
        setMutationRef.current.mutate(pending.length === 0 ? null : pending);
      }
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
          workspaceId: workspaceId,
          rawInput: input.text,
        });
      }
      const firstLine = input.text.split('\n')[0]?.trim() ?? '';
      const title = firstLine.length > 0 ? firstLine.slice(0, 200) : 'Untitled note';
      return api.post<{ id: string; title: string }>('/notes', {
        title,
        body: input.text,
        workspaceId: workspaceId,
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
