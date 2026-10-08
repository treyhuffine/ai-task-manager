"use client";

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DeckVersionSummary {
  id: string;
  createdAt: string;
  origin: string;
  isActive: boolean;
}

const ORIGIN_LABEL: Record<string, string> = {
  morning: 'Morning refresh',
  first_open: 'Dealt for today',
  midday: 'Updated mid-day',
  manual: 'Regenerated',
};

function originLabel(origin: string): string {
  return ORIGIN_LABEL[origin] ?? 'Version';
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Earlier versions of today's deck: the revert escape hatch, opened from
 * "Versions" in the Today section header. Every prior deck is one tap away.
 */
export function DeckVersionList({
  versions,
  currentDeckId,
  onRevert,
}: {
  versions: DeckVersionSummary[];
  currentDeckId?: string;
  onRevert?: (deckId: string) => void;
}) {
  return (
    <>
      {versions.map(v => {
        const isCurrent = v.id === currentDeckId;
        return (
          <div key={v.id} className="flex items-center gap-2 py-1 text-[10px]">
            <span className={cn('flex-1 truncate', isCurrent ? 'text-foreground' : 'text-muted-foreground')}>
              {originLabel(v.origin)}
              <span className="text-muted-foreground/50 ml-1.5">{timeLabel(v.createdAt)}</span>
            </span>
            {isCurrent ? (
              <span className="inline-flex items-center gap-1 text-primary/70">
                <Check className="w-2.5 h-2.5" /> current
              </span>
            ) : (
              <button
                onClick={() => onRevert?.(v.id)}
                className="px-2 py-0.5 rounded-md text-primary hover:bg-primary/10 transition-colors font-medium"
              >
                Use this
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
