'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TreeSearchBarProps {
  query: string;
  onChange: (q: string) => void;
  /** Optional "n of m" caption when filtering. Hidden when empty. */
  matchCount?: number;
  totalCount?: number;
  /** A shortcut hint shown while the field is empty, e.g. "⌘P". */
  shortcut?: string;
}

/**
 * Search field at the top of the tree, above the All / Changes switch.
 * Substring match on the full path — fuzzy ranking would be nicer for
 * a flat command-palette but adds little here, where the tree itself
 * already groups by directory and the user is mostly trying to jump to
 * a known basename or folder segment.
 *
 * Esc clears + blurs so the input doesn't trap keyboard focus. Click on
 * the magnifier focuses the input (cheap one-handed access for users
 * navigating from the rail without leaving the keyboard).
 */
export function TreeSearchBar({
  query,
  onChange,
  matchCount,
  totalCount,
  shortcut,
}: TreeSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // When the parent clears the query externally (e.g., session change)
  // make sure the visible input also clears. Controlled component; the
  // value attr already syncs, but keeping the ref-driven focus consistent
  // is what this effect guards.
  useEffect(() => {
    if (!query && inputRef.current === document.activeElement) {
      // No-op — kept as a hook anchor in case future code wants to
      // react to "query cleared while focused".
    }
  }, [query]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (query) {
        onChange('');
      } else {
        inputRef.current?.blur();
      }
    }
  };

  const showingCount =
    !!query && typeof matchCount === 'number' && typeof totalCount === 'number';

  return (
    <div className="flex h-7 items-center gap-1.5 rounded-md bg-muted/50 px-2 min-w-0 focus-within:bg-muted/70 focus-within:ring-1 focus-within:ring-ring/40">
      <button
        type="button"
        onClick={() => inputRef.current?.focus()}
        className="shrink-0 inline-flex items-center justify-center text-muted-foreground/70 hover:text-foreground transition-colors"
        aria-label="Focus search"
        tabIndex={-1}
      >
        <Search size={12} />
      </button>
      <input
        ref={inputRef}
        // Go to file (⌘P) focuses this from the execution workbench.
        data-tree-search=""
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoComplete="off"
        placeholder="Search files"
        aria-label="Search files"
        className={cn(
          'flex-1 min-w-0 bg-transparent text-[12px] text-foreground/90',
          'placeholder:text-muted-foreground/60 outline-none border-none p-0',
        )}
      />
      {shortcut && !query && (
        <kbd className="shrink-0 rounded bg-background/70 px-1 py-0.5 font-mono text-[9.5px] leading-none text-muted-foreground/80">
          {shortcut}
        </kbd>
      )}
      {showingCount && (
        <span
          className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70"
          title={`${matchCount} match${matchCount === 1 ? '' : 'es'} of ${totalCount} files`}
        >
          {matchCount}/{totalCount}
        </span>
      )}
      {query && (
        <button
          type="button"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          className="shrink-0 inline-flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          aria-label="Clear search"
          title="Clear search (Esc)"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
