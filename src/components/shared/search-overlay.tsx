"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Target, FileText, MessageSquare, X, Loader2 } from 'lucide-react';
import { useSearch } from '@/hooks/use-search';
import { useDashboard } from '@/contexts/dashboard-context';

export function SearchOverlay() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: results, isLoading } = useSearch(query);
  const { openTask, openNote } = useDashboard();

  const handleSelect = useCallback((entityType: string, id: string) => {
    if (entityType === 'task') openTask(id);
    else if (entityType === 'note') openNote(id);
    setOpen(false);
  }, [openTask, openNote]);

  // Cmd+K to open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Search panel */}
      <div className="relative w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={16} className="text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks, notes..."
            className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground"
          />
          {isLoading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
          <button
            onClick={() => setOpen(false)}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {query.trim().length === 0 && (
            <div className="p-8 text-center text-muted-foreground text-[11px]">
              Type to search across tasks, notes, and stream
            </div>
          )}
          {results && results.length === 0 && query.trim().length > 0 && (
            <div className="p-8 text-center text-muted-foreground text-[11px]">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
          {results && results.length > 0 && (
            <div className="py-1">
              {results.map((result) => (
                <button
                  key={`${result.entity_type}-${result.id}`}
                  className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => handleSelect(result.entity_type, result.id)}
                >
                  <div className="mt-0.5 flex-shrink-0">
                    {result.entity_type === 'task' && <Target size={14} className="text-primary/60" />}
                    {result.entity_type === 'note' && <FileText size={14} className="text-primary/60" />}
                    {result.entity_type === 'stream' && <MessageSquare size={14} className="text-primary/60" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium leading-tight line-clamp-1">
                      {result.title || result.body || '(untitled)'}
                    </p>
                    {result.description && (
                      <p className="mt-0.5 text-[10.5px] text-muted-foreground leading-snug line-clamp-2">
                        {result.description}
                      </p>
                    )}
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/60">
                        {result.entity_type}
                      </span>
                      <span className="text-[8px] text-muted-foreground/60">
                        {new Date(result.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border text-[9px] text-muted-foreground/50 flex items-center gap-3">
          <span><kbd className="px-1 py-0.5 bg-muted rounded text-[8px]">ESC</kbd> to close</span>
          <span><kbd className="px-1 py-0.5 bg-muted rounded text-[8px]">{'\u2318'}K</kbd> to toggle</span>
        </div>
      </div>
    </div>
  );
}
