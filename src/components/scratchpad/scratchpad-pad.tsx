'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import { Loader2, Maximize2, MessageSquare, NotebookPen, Radio, Square, StickyNote, X } from 'lucide-react';
import { toast } from 'sonner';
import { RichEditor } from '@/components/editor/rich-editor';
import { Tip } from '@/components/ui/tip';
import { useScratchpad } from '@/hooks/use-scratchpad';
import type { ScratchpadSaver } from '@/lib/client/scratchpad-saver';
import { useCreateTask } from '@/hooks/use-tasks';
import { useCreateNote } from '@/hooks/use-notes';
import { useCreateStream } from '@/hooks/use-stream';
import { composerTarget, subscribeComposers } from '@/components/chat/editor/composer-focus';
import { consumeScratchpadFocus, SCRATCHPAD_FOCUS_EVENT } from '@/lib/client/scratchpad-open';
import { cn } from '@/lib/utils';
import { padTarget, replaceChanged, targetStillThere, titleAndBody, type PadTarget } from './pad-target';

/**
 * The scratchpad (docs/scratchpad.md): one page of working memory, the same
 * on every screen and device. Nothing reads or sorts it. The bar along the
 * bottom moves the line the caret is on, or the selection, somewhere else
 * when you choose: a task or a note (a chip to it stays in its place), the
 * Stream (handed off, so it leaves the page), or the chat on screen.
 */
export function ScratchpadPad({ onClose, closeShortcut, expanded = false, onExpand, onEditor, onSendToChat }: {
  onClose: () => void;
  closeShortcut?: string;
  expanded?: boolean;
  onExpand?: () => void;
  onEditor?: (editor: Editor | null) => void;
  onSendToChat?: () => void;
}) {
  const { saver, snapshot, loadError, retry } = useScratchpad();
  return (
    <div data-scratchpad data-expanded={expanded} className="flex h-full min-h-0 w-full flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/50 pl-4 pr-2">
        <NotebookPen size={14} className="shrink-0 text-muted-foreground" />
        <h2 className="mr-auto shrink-0 text-xs font-semibold">Scratchpad</h2>
        <SaveState saving={snapshot.saving} error={snapshot.error} updatedAt={snapshot.updatedAt} />
        {onExpand && (
          <Tip label="Open in a slideout">
            <button type="button" onClick={onExpand} onMouseDown={(e) => e.preventDefault()}
              aria-label="Expand the scratchpad"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
              <Maximize2 size={14} />
            </button>
          </Tip>
        )}
        <Tip label="Close" shortcut={closeShortcut}>
          <button type="button" onClick={onClose} aria-label="Close the scratchpad"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
            <X size={15} />
          </button>
        </Tip>
      </header>
      {snapshot.ready ? (
        <PadBody saver={saver} draft={snapshot.draft} revision={snapshot.revision} expanded={expanded} onEditor={onEditor} onSendToChat={onSendToChat} />
      ) : loadError ? (
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
          <p>Your scratchpad could not be loaded.</p>
          <button type="button" onClick={retry} className="underline hover:text-foreground">Try again</button>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-muted-foreground" aria-label="Loading the scratchpad">
          <Loader2 size={14} className="animate-spin" />
        </div>
      )}
    </div>
  );
}

/** The editor, from the moment the stored text has arrived. */
function PadBody({ saver, draft, revision, expanded, onEditor, onSendToChat }: {
  saver: ScratchpadSaver; draft: string; revision: number; expanded: boolean;
  onEditor?: (editor: Editor | null) => void;
  onSendToChat?: () => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const receiveEditor = useCallback((value: Editor | null) => { setEditor(value); onEditor?.(value); }, [onEditor]);
  // The editor starts from the text as it arrived. Everything after comes
  // through the saver's revisions below, never through the editor's prop.
  const [initial] = useState(draft);
  const applied = useRef(revision);

  // Text from outside this editor (another device, a merge) changes only the
  // part that differs, so the caret moves with it. It isn't an edit here, so
  // it neither saves again nor joins this editor's undo history.
  // Deferred a microtask, as rich-editor.tsx does: a chip's React view
  // renders with flushSync, which can't run inside an effect.
  useEffect(() => {
    if (!editor || revision === applied.current) return;
    applied.current = revision;
    queueMicrotask(() => {
      if (editor.isDestroyed || editor.getMarkdown() === draft) return;
      const json = editor.markdown?.parse(draft);
      if (!json) return;
      const tr = replaceChanged(editor.state, editor.schema.nodeFromJSON(json));
      if (tr) editor.view.dispatch(tr.setMeta('preventUpdate', true).setMeta('addToHistory', false));
    });
  }, [editor, revision, draft]);

  // The shortcut, or opening the pad, puts the caret here.
  useEffect(() => {
    if (!editor) return;
    // Touch browsers focus synchronously inside the command. Wait a frame
    // for the editor's initial node views to settle before focusing.
    const focus = () => {
      consumeScratchpadFocus();
      requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        editor.commands.focus('end');
      });
    };
    if (consumeScratchpadFocus()) focus();
    window.addEventListener(SCRATCHPAD_FOCUS_EVENT, focus);
    return () => window.removeEventListener(SCRATCHPAD_FOCUS_EVENT, focus);
  }, [editor]);

  const onChange = useCallback((markdown: string) => saver.edit(markdown), [saver]);

  return (
    <>
      <div data-compact={!expanded} className={cn(
        'scratchpad-editor min-h-0 flex-1 overflow-y-auto pb-6',
        expanded ? 'pl-12 pr-6 pt-5 pointer-coarse:pl-4' : 'px-4 pt-3',
      )}>
        <RichEditor
          content={initial}
          onChange={onChange}
          onEditor={receiveEditor}
          className={expanded ? 'mx-auto max-w-3xl' : undefined}
          placeholder="Write a note…"
          hideFooter
        />
      </div>
      {editor && <MoveBar editor={editor} onSendToChat={onSendToChat} />}
    </>
  );
}

function SaveState({ saving, error, updatedAt }: { saving: boolean; error: string | null; updatedAt: string | null }) {
  if (error) return <span role="status" className="truncate text-[10px] text-amber-600 dark:text-amber-500">{error}</span>;
  if (saving) return <span role="status" className="text-[10px] text-muted-foreground/60">Saving…</span>;
  return <span role="status" className="text-[10px] text-muted-foreground/60">{updatedAt ? 'Saved' : 'Saves as you type'}</span>;
}

/** Follows the editor's selection, so the bar always says what it would move. */
function useTarget(editor: Editor): PadTarget | null {
  const [target, setTarget] = useState(() => padTarget(editor.state));
  useEffect(() => {
    const update = () => setTarget(padTarget(editor.state));
    editor.on('selectionUpdate', update);
    editor.on('update', update);
    return () => { editor.off('selectionUpdate', update); editor.off('update', update); };
  }, [editor]);
  return target;
}

/** Whether a chat's message box is on screen to take a line. */
function useChatOnScreen(): boolean {
  return useSyncExternalStore(subscribeComposers, () => composerTarget() !== null, () => false);
}

function MoveBar({ editor, onSendToChat }: { editor: Editor; onSendToChat?: () => void }) {
  const target = useTarget(editor);
  const chatOnScreen = useChatOnScreen();
  const createTask = useCreateTask();
  const createNote = useCreateNote();
  const createStream = useCreateStream();
  const [pending, setPending] = useState<'task' | 'note' | 'stream' | null>(null);

  /** A chip to what was made takes the text's place, where it still is. */
  const placeChip = (moved: PadTarget, kind: 'task' | 'note', id: string) => {
    const chip = { type: 'entityLink', attrs: { kind, id } };
    if (targetStillThere(editor.state, moved)) {
      editor.chain().insertContentAt({ from: moved.from, to: moved.to }, chip).run();
    } else {
      editor.chain().insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: [chip] }).run();
    }
  };

  const toEntity = async (kind: 'task' | 'note') => {
    if (!target || pending) return;
    const moved = target;
    const { title, body } = titleAndBody(moved.text);
    setPending(kind);
    try {
      const created = kind === 'task'
        ? await createTask.mutateAsync({ title, body: body || undefined, rawInput: moved.text })
        : await createNote.mutateAsync({ title, body: body || title });
      placeChip(moved, kind, created.id);
    } catch {
      toast.error(kind === 'task' ? 'Could not make the task' : 'Could not make the note', { description: 'The text is still on your scratchpad.' });
    } finally { setPending(null); }
  };

  const toStream = async () => {
    if (!target || pending) return;
    const moved = target;
    setPending('stream');
    try {
      await createStream.mutateAsync({ rawText: moved.text, source: 'capture', media: 'text' });
      if (targetStillThere(editor.state, moved)) editor.chain().deleteRange({ from: moved.removeFrom, to: moved.removeTo }).run();
      toast.success('In your Stream', { description: moved.text.length > 80 ? `${moved.text.slice(0, 80)}…` : moved.text });
    } catch {
      toast.error('Could not send it to your Stream', { description: 'The text is still on your scratchpad.' });
    } finally { setPending(null); }
  };

  const toChat = () => {
    const composer = composerTarget();
    if (!target || !composer) return;
    composer.insert(`${target.text} `);
    onSendToChat?.();
  };

  const subject = target?.kind === 'selection' ? 'the selection' : 'this line';
  const disabled = !target || pending !== null;
  return (
    <div className="shrink-0 border-t border-border/50 bg-muted/20 px-3 pb-2 pt-2">
      <div className="mb-1.5 flex min-w-0 items-baseline gap-1.5 text-[11px] text-muted-foreground">
        {target ? <>
          <span className="shrink-0 font-medium">{target.kind === 'selection' ? 'Selection' : 'This line'}</span>
          <span className="truncate text-muted-foreground/70">{target.text}</span>
        </> : <span>Click a line or select text to move it</span>}
      </div>
      <div className="grid grid-cols-4 gap-1">
        <MoveButton label="Task" tip={`Make ${subject} a task, and leave a link to it here`} icon={Square} busy={pending === 'task'} disabled={disabled} onClick={() => void toEntity('task')} />
        <MoveButton label="Note" tip={`Make ${subject} a note, and leave a link to it here`} icon={StickyNote} busy={pending === 'note'} disabled={disabled} onClick={() => void toEntity('note')} />
        <MoveButton label="Stream" tip={`Hand ${subject} to your Stream to sort out, and clear it from here`} icon={Radio} busy={pending === 'stream'} disabled={disabled} onClick={() => void toStream()} />
        <MoveButton label="Chat" tip={chatOnScreen ? `Add ${subject} to the message you're writing` : 'Open a chat to add this to its message'} icon={MessageSquare} disabled={disabled || !chatOnScreen} onClick={toChat} />
      </div>
    </div>
  );
}

function MoveButton({ label, tip, icon: Icon, busy = false, disabled, onClick }: {
  label: string;
  tip: string;
  icon: typeof Square;
  busy?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tip label={tip}>
      {/* Keep the editor's caret where it is, so the line stays the target. */}
      <button type="button" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
        className={cn(
          'inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border border-border/70 bg-background px-1 text-[11px] font-medium transition-colors pointer-coarse:h-10',
          'hover:bg-muted/60 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-40',
        )}>
        {busy ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <Icon size={13} className="shrink-0" />}
        {label}
      </button>
    </Tip>
  );
}

