'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import { Loader2, MessageSquare, Radio, Square, StickyNote, X } from 'lucide-react';
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
export function ScratchpadPad({ onClose, closeShortcut }: { onClose: () => void; closeShortcut?: string }) {
  const { saver, snapshot, loadError, retry } = useScratchpad();
  return (
    <div data-scratchpad className="flex h-full min-h-0 w-full flex-col bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b border-border/50 py-1 pl-3 pr-1.5">
        <h2 className="text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Scratchpad</h2>
        <SaveState saving={snapshot.saving} error={snapshot.error} updatedAt={snapshot.updatedAt} />
        <Tip label="Close" shortcut={closeShortcut}>
          <button type="button" onClick={onClose} aria-label="Close the scratchpad"
            className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
            <X size={13} />
          </button>
        </Tip>
      </header>
      {snapshot.ready ? (
        <PadBody saver={saver} draft={snapshot.draft} revision={snapshot.revision} />
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
function PadBody({ saver, draft, revision }: { saver: ScratchpadSaver; draft: string; revision: number }) {
  const [editor, setEditor] = useState<Editor | null>(null);
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
    if (consumeScratchpadFocus()) editor.commands.focus('end');
    const focus = () => { consumeScratchpadFocus(); editor.commands.focus('end'); };
    window.addEventListener(SCRATCHPAD_FOCUS_EVENT, focus);
    return () => window.removeEventListener(SCRATCHPAD_FOCUS_EVENT, focus);
  }, [editor]);

  const onChange = useCallback((markdown: string) => saver.edit(markdown), [saver]);

  return (
    <>
      <div className="scratchpad-editor min-h-0 flex-1 overflow-y-auto pb-6 pl-11 pr-4 pt-3 pointer-coarse:pl-4">
        <RichEditor
          content={initial}
          onChange={onChange}
          onEditor={setEditor}
          placeholder="Anything on your mind. It stays here until you move it."
          hideFooter
        />
      </div>
      {editor && <MoveBar editor={editor} />}
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

function MoveBar({ editor }: { editor: Editor }) {
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
  };

  const subject = target?.kind === 'selection' ? 'the selection' : 'this line';
  const disabled = !target || pending !== null;
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-t border-border/50 bg-muted/20 px-2 py-1">
      <span className="mr-auto truncate pl-1 text-[10px] text-muted-foreground/60">
        {target ? (target.kind === 'selection' ? 'Move the selection' : 'Move this line') : 'Put the caret on a line to move it'}
      </span>
      <MoveButton label="Task" tip={`Make ${subject} a task, and leave a link to it here`} icon={Square} busy={pending === 'task'} disabled={disabled} onClick={() => void toEntity('task')} />
      <MoveButton label="Note" tip={`Make ${subject} a note, and leave a link to it here`} icon={StickyNote} busy={pending === 'note'} disabled={disabled} onClick={() => void toEntity('note')} />
      <MoveButton label="Stream" tip={`Hand ${subject} to your Stream to sort out, and clear it from here`} icon={Radio} busy={pending === 'stream'} disabled={disabled} onClick={() => void toStream()} />
      <MoveButton label="Chat" tip={chatOnScreen ? `Add ${subject} to the message you're writing` : 'Open a chat to add this to its message'} icon={MessageSquare} disabled={disabled || !chatOnScreen} onClick={toChat} />
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
          'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground transition-colors',
          'hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
        )}>
        {busy ? <Loader2 size={10} className="animate-spin" /> : <Icon size={10} />}
        {label}
      </button>
    </Tip>
  );
}

