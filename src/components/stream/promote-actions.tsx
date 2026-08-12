"use client";

import { useState, useRef, useCallback } from 'react';
import {
  Target, FileText, ChevronDown, Search, Plus, GitMerge,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { useTasks } from '@/hooks/use-tasks';
import { useNotes } from '@/hooks/use-notes';
import type { TaskStatus } from '@/db/types';

// ─── Task promote/merge ─────────────────────────────────────

interface TaskActionsProps {
  onPromote: () => void;
  onMerge: (taskId: string) => void;
}

export function TaskActions({ onPromote, onMerge }: TaskActionsProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'menu' | 'search'>('menu');
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: tasks } = useTasks({ status: 'active' });

  const filtered = (tasks ?? []).filter(t =>
    t.title.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 8);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setMode('menu');
      setQuery('');
    }
  }, []);

  const handleMerge = useCallback((taskId: string) => {
    onMerge(taskId);
    handleOpenChange(false);
  }, [onMerge, handleOpenChange]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-0.5 p-1.5 rounded-md text-primary hover:bg-primary/10 transition-colors"
        >
          <Target size={12} />
          <ChevronDown size={8} className="text-primary/50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0" sideOffset={4}>
        {mode === 'menu' && (
          <div className="py-1">
            <button
              onClick={() => { onPromote(); handleOpenChange(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-foreground hover:bg-muted transition-colors"
            >
              <Plus size={12} className="text-primary" />
              <span className="font-medium">New task</span>
            </button>
            <button
              onClick={() => { setMode('search'); setTimeout(() => inputRef.current?.focus(), 0); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-foreground hover:bg-muted transition-colors"
            >
              <GitMerge size={12} className="text-muted-foreground" />
              <span className="font-medium">Merge into task...</span>
            </button>
          </div>
        )}

        {mode === 'search' && (
          <div>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <Search size={12} className="text-muted-foreground flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tasks..."
                className="flex-1 text-[11px] bg-transparent outline-none placeholder:text-muted-foreground/50"
              />
            </div>
            <div className="max-h-48 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-[10px] text-muted-foreground">No tasks found</p>
              )}
              {filtered.map((task) => (
                <button
                  key={task.id}
                  onClick={() => handleMerge(task.id)}
                  className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-muted transition-colors"
                >
                  <Target size={10} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                  <span className="text-[10.5px] text-foreground leading-snug line-clamp-2">
                    {task.title}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Note promote/merge ─────────────────────────────────────

interface NoteActionsProps {
  onPromote: () => void;
  onMerge: (noteId: string) => void;
}

export function NoteActions({ onPromote, onMerge }: NoteActionsProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'menu' | 'search'>('menu');
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: notes } = useNotes({ status: 'active' });

  const filtered = (notes ?? []).filter(n => {
    const text = (n.title ?? n.bodyExcerpt ?? '').toLowerCase();
    return text.includes(query.toLowerCase());
  }).slice(0, 8);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setMode('menu');
      setQuery('');
    }
  }, []);

  const handleMerge = useCallback((noteId: string) => {
    onMerge(noteId);
    handleOpenChange(false);
  }, [onMerge, handleOpenChange]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-0.5 p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
        >
          <FileText size={12} />
          <ChevronDown size={8} className="opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0" sideOffset={4}>
        {mode === 'menu' && (
          <div className="py-1">
            <button
              onClick={() => { onPromote(); handleOpenChange(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-foreground hover:bg-muted transition-colors"
            >
              <Plus size={12} className="text-primary" />
              <span className="font-medium">New note</span>
            </button>
            <button
              onClick={() => { setMode('search'); setTimeout(() => inputRef.current?.focus(), 0); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-foreground hover:bg-muted transition-colors"
            >
              <GitMerge size={12} className="text-muted-foreground" />
              <span className="font-medium">Append to note...</span>
            </button>
          </div>
        )}

        {mode === 'search' && (
          <div>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <Search size={12} className="text-muted-foreground flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notes..."
                className="flex-1 text-[11px] bg-transparent outline-none placeholder:text-muted-foreground/50"
              />
            </div>
            <div className="max-h-48 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-[10px] text-muted-foreground">No notes found</p>
              )}
              {filtered.map((note) => (
                <button
                  key={note.id}
                  onClick={() => handleMerge(note.id)}
                  className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-muted transition-colors"
                >
                  <FileText size={10} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                  <span className="text-[10.5px] text-foreground leading-snug line-clamp-2">
                    {note.title ?? (note.bodyExcerpt ?? '').slice(0, 80)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
