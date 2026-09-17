'use client';

import { FileText, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EntityViewMode } from '@/lib/client/entity-view-mode';

/**
 * Agent / Document switch for a note or task. Only rendered while the
 * agent-first trial is on (Settings > General > Notes and tasks), so the
 * default UI is untouched. "Document" is the existing editor surface; the
 * user's "jump into the note" to see and edit the actual words.
 */
export function EntityViewToggle({
  value,
  onChange,
  className,
  compact = false,
}: {
  value: EntityViewMode;
  onChange: (next: EntityViewMode) => void;
  className?: string;
  /** Icon-only. Hosts pass this when their header is cramped (a narrow
   *  slideout). Below the `sm` viewport the labels hide on their own. */
  compact?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="View"
      className={cn('inline-flex rounded-md border border-border p-0.5 text-[10.5px]', className)}
    >
      {(['agent', 'editor'] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={value === m}
          onClick={() => onChange(m)}
          title={m === 'agent' ? 'Agent view' : 'Document view'}
          aria-label={m === 'agent' ? 'Agent view' : 'Document view'}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium transition-colors',
            value === m ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {m === 'agent' ? <Sparkles size={10} /> : <FileText size={10} />}
          <span className={cn(compact ? 'hidden' : 'hidden sm:inline')}>{m === 'agent' ? 'Agent' : 'Document'}</span>
        </button>
      ))}
    </div>
  );
}
