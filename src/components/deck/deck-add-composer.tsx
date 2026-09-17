"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Loader2, CornerDownLeft } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useCreateTask } from '@/hooks/use-tasks';
import { apiErrorText } from '@/lib/api/client';
import type { TaskRecord } from '@/db/types';

interface DeckAddComposerProps {
  onTaskCreated: (task: TaskRecord) => void;
  /**
   * `persistent`: always visible, never closes.
   * `trigger`: opened from the day bar; autofocuses, and Esc / empty blur
   * dismisses it.
   */
  variant: 'persistent' | 'trigger';
  onClose?: () => void;
}

/**
 * The redesigned "add a task to today" composer for the Deck quick-add trial.
 *
 * The whole point of the trial is mode clarity: unlike the classic inline card
 * (which was styled to match a deck card, so a click landed you in a bare
 * cursor with no signal), this plainly reads as an input at rest — a bordered
 * field with a `+` and a readable placeholder — and lights up on focus with a
 * ring and an Enter affordance. There is never an "am I typing?" moment.
 *
 * It creates the task as Todo and hands the record back; it never starts work
 * or moves the task to In progress.
 */
export function DeckAddComposer({ onTaskCreated, variant, onClose }: DeckAddComposerProps) {
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const createTask = useCreateTask();

  // Trigger mode is opened by an explicit user action, so grabbing focus is
  // expected. Persistent mode must not steal focus on page load.
  useEffect(() => {
    if (variant === 'trigger') inputRef.current?.focus();
  }, [variant]);

  const submit = useCallback(() => {
    const trimmed = title.trim();
    if (!trimmed || createTask.isPending) return;
    createTask.mutate(
      { title: trimmed, rawInput: trimmed },
      {
        onSuccess: (task) => {
          onTaskCreated(task);
          setTitle('');
          inputRef.current?.focus(); // stay put so you can add several in a row
        },
        onError: (err) => {
          // Keep the typed title so the user retries the same task rather than
          // risk a duplicate by re-typing. The failure is surfaced, never silent.
          toast.error('Could not create task', { description: apiErrorText(err) });
          inputRef.current?.focus();
        },
      },
    );
  }, [title, createTask, onTaskCreated]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
      if (e.key === 'Escape') {
        // Esc clears a draft first; a second Esc (empty) closes trigger mode.
        if (title) {
          setTitle('');
          return;
        }
        onClose?.();
      }
    },
    [submit, title, onClose],
  );

  const hasText = title.trim().length > 0;

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-lg border bg-background px-3 py-2 transition-colors',
        'border-border focus-within:border-ring focus-within:ring-1 focus-within:ring-ring',
      )}
    >
      <Plus className="h-4 w-4 shrink-0 text-muted-foreground/70 transition-colors group-focus-within:text-foreground" />
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={
          variant === 'trigger'
            ? () => {
                // Small delay so a click on the Add button lands first.
                setTimeout(() => {
                  if (!title.trim()) onClose?.();
                }, 150);
              }
            : undefined
        }
        placeholder="Add a task to today"
        aria-label="Add a task to today"
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
      />
      {createTask.isPending ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : hasText ? (
        <button
          type="button"
          // Keep the input focused so the blur-close timeout never fires.
          onMouseDown={(e) => e.preventDefault()}
          onClick={submit}
          className="flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
        >
          <CornerDownLeft className="h-3 w-3" />
          Add
        </button>
      ) : (
        <span className="shrink-0 text-[10px] text-muted-foreground/50">
          {variant === 'trigger' ? 'Enter to add · Esc to close' : 'Enter to add'}
        </span>
      )}
    </div>
  );
}
