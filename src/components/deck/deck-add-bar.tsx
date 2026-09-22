"use client";

import { useCallback, useMemo, useRef, useState } from 'react';
import { Plus, Loader2, CornerDownLeft, ArrowUpRight } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useCreateTask } from '@/hooks/use-tasks';
import { apiErrorText } from '@/lib/api/client';
import type { TaskRecord } from '@/db/types';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';

interface DeckAddBarProps {
  /** Active tasks to match against as you type (for the "pull existing" path). */
  candidates: TaskListDTO[];
  /** Task ids already on the deck — never offered as a match. */
  excludeIds: Set<string>;
  /** A brand-new task was created; hand it to the deck (same as quick-add). */
  onTaskCreated: (task: TaskRecord) => void;
  /** Pull an existing task onto the deck. */
  onAddExisting: (task: TaskListDTO) => void;
}

const MAX_MATCHES = 6;

/**
 * One field that reconciles "add a task" (create new) with "more options" (pull
 * an existing one). You type an intent; it offers to create that task AND
 * surfaces matching tasks you already have to pull in. Create-or-pull in one
 * place — the original source sketch ("[new task name +] / [list of similar
 * tasks +]"). It never starts work; new tasks are created as Todo.
 */
export function DeckAddBar({ candidates, excludeIds, onTaskCreated, onAddExisting }: DeckAddBarProps) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const createTask = useCreateTask();

  const q = query.trim();

  const matches = useMemo(() => {
    if (!q) return [];
    const ql = q.toLowerCase();
    return candidates
      .filter((t) => t.status === 'todo' && !excludeIds.has(t.id) && t.title.toLowerCase().includes(ql))
      .sort((a, b) => {
        const rank = (t: TaskListDTO) => (t.title.toLowerCase().startsWith(ql) ? 0 : 1);
        return rank(a) - rank(b);
      })
      .slice(0, MAX_MATCHES);
  }, [q, candidates, excludeIds]);

  // Option 0 is always "create new"; matches follow.
  const optionCount = 1 + matches.length;
  const open = focused && q.length > 0;

  const reset = useCallback(() => {
    setQuery('');
    setHighlight(0);
  }, []);

  const create = useCallback(() => {
    if (!q || createTask.isPending) return;
    createTask.mutate(
      { title: q, rawInput: q },
      {
        onSuccess: (task) => {
          onTaskCreated(task);
          reset();
          inputRef.current?.focus();
        },
        onError: (err) => {
          // Keep the text so a retry reuses it rather than risking a duplicate.
          toast.error('Could not create task', { description: apiErrorText(err) });
          inputRef.current?.focus();
        },
      },
    );
  }, [q, createTask, onTaskCreated, reset]);

  const pick = useCallback(
    (task: TaskListDTO) => {
      onAddExisting(task);
      reset();
      inputRef.current?.focus();
    },
    [onAddExisting, reset],
  );

  const choose = useCallback(
    (index: number) => {
      if (index === 0) create();
      else pick(matches[index - 1]);
    },
    [create, pick, matches],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % optionCount);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + optionCount) % optionCount);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        choose(Math.min(highlight, optionCount - 1));
      } else if (e.key === 'Escape') {
        if (q) reset();
        else inputRef.current?.blur();
      }
    },
    [optionCount, highlight, choose, q, reset],
  );

  return (
    <div className="relative">
      <div
        className={cn(
          'group flex items-center gap-2 rounded-lg border bg-background px-3 py-2 transition-colors',
          'border-border focus-within:border-ring focus-within:ring-1 focus-within:ring-ring',
        )}
      >
        <Plus className="h-4 w-4 shrink-0 text-muted-foreground/70 transition-colors group-focus-within:text-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          // Delay so a mousedown on an option is handled before we close.
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          placeholder="Add a task, or find an existing one"
          aria-label="Add a task, or find an existing one"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
        {createTask.isPending ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <span className="shrink-0 text-[10px] text-muted-foreground/50">
            {q ? '↑↓ to choose · ↵ to add' : 'Enter to add'}
          </span>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-popover shadow-md">
          {/* Create new */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setHighlight(0)}
            onClick={() => choose(0)}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors',
              highlight === 0 ? 'bg-muted' : 'hover:bg-muted/60',
            )}
          >
            <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">
              Create task <span className="font-medium text-foreground">“{q}”</span>
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">new</span>
          </button>

          {matches.length > 0 && (
            <>
              <div className="border-t border-border/60 px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Add existing
              </div>
              {matches.map((t, i) => {
                const idx = i + 1;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => choose(idx)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors',
                      highlight === idx ? 'bg-muted' : 'hover:bg-muted/60',
                    )}
                  >
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-foreground">{t.title}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
