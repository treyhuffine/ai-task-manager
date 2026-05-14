'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight, File as FileIcon, Folder, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TreeInputRowProps {
  /** Render depth in the tree — keeps the input visually aligned with siblings. */
  depth: number;
  kind: 'file' | 'dir';
  /** Initial value for the input (rename starts with the existing name). */
  initialValue?: string;
  /** Caption shown when the parent operation is in flight. */
  busyLabel?: string;
  isBusy?: boolean;
  errorMessage?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

const INDENT_PX = 12;

/**
 * The inline editor we render inside the tree for "New File", "New
 * Folder", and "Rename". One component covers all three because the
 * keyboard semantics + alignment rules are identical — the parent
 * supplies the icon and initial value.
 *
 * Enter submits, Escape cancels, blur cancels (matches Finder/VS Code's
 * "click away to abort" model). The parent passes `isBusy` while the
 * mutation is in flight so we can lock the input + show a spinner
 * instead of letting the user double-submit.
 */
export function TreeInputRow({
  depth,
  kind,
  initialValue = '',
  isBusy,
  errorMessage,
  onSubmit,
  onCancel,
}: TreeInputRowProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Select the basename minus extension so the user can start typing
    // immediately to replace the name (matches Finder rename behavior).
    if (initialValue) {
      const dot = initialValue.lastIndexOf('.');
      el.setSelectionRange(0, dot > 0 ? dot : initialValue.length);
    }
  }, [initialValue]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed) return;
      onSubmit(trimmed);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
    // Stop the tree's keyboard handlers (if any are added later) from
    // also acting on this keystroke.
    e.stopPropagation();
  };

  const Icon = kind === 'dir' ? Folder : FileIcon;

  return (
    <div
      style={{ paddingLeft: 6 + depth * INDENT_PX }}
      className="flex w-full items-center gap-1 py-0.5 pr-2"
    >
      <ChevronRight size={12} className="shrink-0 text-transparent" />
      <Icon size={13} className="shrink-0 text-muted-foreground/60" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Blur cancels only if the user hasn't already triggered a
          // submit (busy = "submit fired, awaiting result").
          if (!isBusy) onCancel();
        }}
        disabled={isBusy}
        spellCheck={false}
        autoComplete="off"
        className={cn(
          'flex-1 min-w-0 rounded-sm bg-background border border-border/80 px-1 py-0.5 text-[12px] text-foreground outline-none focus:border-primary',
          errorMessage && 'border-destructive focus:border-destructive',
        )}
        placeholder={kind === 'dir' ? 'folder name' : 'file name'}
        aria-label={kind === 'dir' ? 'Folder name' : 'File name'}
      />
      {isBusy && (
        <Loader2 size={11} className="shrink-0 animate-spin text-muted-foreground" />
      )}
      {errorMessage && !isBusy && (
        <span
          className="shrink-0 text-[10px] text-destructive truncate max-w-[140px]"
          title={errorMessage}
        >
          {errorMessage}
        </span>
      )}
    </div>
  );
}
