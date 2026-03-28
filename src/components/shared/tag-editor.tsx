"use client";

import { useState, useRef } from 'react';
import { X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  className?: string;
}

export function TagEditor({ tags, onChange, className }: TagEditorProps) {
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleRemove = (tag: string) => {
    onChange(tags.filter(t => t !== tag));
  };

  const handleAdd = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setAdding(false);
  };

  return (
    <div className={cn('inline-flex items-center gap-1 flex-wrap', className)}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="group/tag inline-flex items-center gap-0.5 text-[8px] font-bold text-primary/70 bg-primary/5 px-1.5 py-0.5 rounded hover:bg-primary/10 transition-colors"
        >
          {tag}
          <button
            onClick={(e) => { e.stopPropagation(); handleRemove(tag); }}
            className="opacity-0 group-hover/tag:opacity-100 text-primary/40 hover:text-destructive transition-opacity"
          >
            <X size={7} />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          ref={inputRef}
          autoFocus
          type="text"
          placeholder="tag"
          className="text-[9px] bg-background border border-border rounded px-1.5 py-0.5 w-16 outline-none focus:ring-1 focus:ring-primary"
          onBlur={(e) => handleAdd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setAdding(false);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setAdding(true); }}
          className="inline-flex items-center text-[8px] text-muted-foreground/40 hover:text-muted-foreground px-0.5 py-0.5 rounded hover:bg-muted transition-colors"
          title="Add tag"
        >
          <Plus size={8} />
        </button>
      )}
    </div>
  );
}
