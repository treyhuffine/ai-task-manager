"use client";

import { useCallback, useRef, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useCreateTask } from '@/hooks/use-tasks';
import type { TaskRecord } from '@/db/types';

interface DeckQuickAddCardProps {
  onTaskCreated: (task: TaskRecord) => void;
  onClose: () => void;
}

/**
 * Renders as an inline deck item at the bottom of the stack.
 * Matches the visual layout of a real SortableDeckItemCard:
 * same pl-6 pr-20, same text-sm font-medium, same vertical rhythm.
 */
export function DeckQuickAddCard({ onTaskCreated, onClose }: DeckQuickAddCardProps) {
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const createTask = useCreateTask();

  useEffect(() => {
    // Scroll the card into view and focus
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = title.trim();
    if (!trimmed || createTask.isPending) return;

    createTask.mutate(
      { title: trimmed, raw_input: trimmed },
      {
        onSuccess: (task) => {
          onTaskCreated(task);
          setTitle('');
          inputRef.current?.focus();
        },
      },
    );
  }, [title, createTask, onTaskCreated]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSubmit, onClose],
  );

  return (
    <div ref={containerRef} className="relative py-2">
      <div className="pl-6 pr-20">
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Small delay so click events on the button can fire first
            setTimeout(() => {
              if (!title.trim()) onClose();
            }, 150);
          }}
          placeholder="What needs to get done?"
          className="w-full text-sm font-medium bg-transparent text-foreground placeholder:text-muted-foreground/30 focus:outline-none leading-snug"
        />
        <div className="flex items-center gap-2 mt-1.5">
          {createTask.isPending ? (
            <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
          ) : (
            <span className="text-[10px] text-muted-foreground/30">
              Enter to add · Esc to close
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
