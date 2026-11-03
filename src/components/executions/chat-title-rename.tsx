'use client';

import { useEffect, useRef, useState } from 'react';
import { useUpdateSession } from '@/hooks/use-execution';
import type { ChatSessionWithExecution } from '@/lib/api/dto/records';
import { cn } from '@/lib/utils';

/** A chat's title being renamed in place (`useChatRename`). */
export interface ChatRename {
  /** The title, or null when it has none yet. */
  label: string | null;
  editing: boolean;
  /** Turns the title into a field holding it. */
  begin: () => void;
  draft: string;
  setDraft: (draft: string) => void;
  /** Saves the field and turns it back into the title. */
  commit: () => void;
  /** Turns it back without saving. */
  cancel: () => void;
}

/**
 * Renaming a chat from its title, the same in the execution view's header
 * and in the chat open beside an agent's main chat: click the title and it
 * becomes a field (`ChatTitleInput`). Enter or leaving the field saves via
 * PATCH /api/sessions/:id, Escape cancels. The draft holds the text being
 * typed, so React Query repaints from server data don't clobber it.
 *
 * The title is the EXECUTION's label, stable across its chats. Starting a
 * new chat on the same execution gives that chat its own `session.label`
 * (its title in the All chats list) and leaves this one alone. Only an
 * orphaned chat, whose execution was hard-deleted, falls back to its own.
 *
 * `editingId` also ends the edit when the chat changes, without an effect.
 * The execution view doesn't remount on navigation, so a boolean alone
 * would carry a rename in progress into the next chat.
 */
export function useChatRename(session: ChatSessionWithExecution): ChatRename {
  const updateSession = useUpdateSession();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const label = session.execution?.label ?? session.label ?? null;

  return {
    label,
    editing: editingId === session.id,
    begin: () => {
      setDraft(label ?? '');
      setEditingId(session.id);
    },
    draft,
    setDraft,
    commit: () => {
      const next = draft.trim();
      setEditingId(null);
      if (next === (label ?? '')) return;
      // Rename the execution, the durable artifact, so the title survives a
      // new chat. An orphaned chat renames itself.
      if (session.executionId) {
        updateSession.mutate({ id: session.id, executionLabel: next || null });
      } else {
        updateSession.mutate({ id: session.id, label: next || null });
      }
    },
    cancel: () => setEditingId(null),
  };
}

/**
 * The field a title turns into while it's renamed, focused with its text
 * selected. Its size is the caller's, to match the title it replaces.
 */
export function ChatTitleInput({ rename, className }: { rename: ChatRename; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const input = ref.current;
      input?.focus();
      // The phone and desktop headers both render the field and one is
      // hidden, so only the one that took focus selects.
      if (input && document.activeElement === input) input.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <input
      ref={ref}
      value={rename.draft}
      onChange={(e) => rename.setDraft(e.target.value)}
      onBlur={rename.commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          rename.commit();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          rename.cancel();
        }
      }}
      aria-label="Chat title"
      placeholder="Untitled"
      maxLength={120}
      spellCheck={false}
      className={cn(
        'min-w-0 rounded border border-primary/40 bg-background font-semibold text-foreground focus:outline-none',
        className,
      )}
    />
  );
}
