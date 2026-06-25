"use client";

import { useState } from 'react';
import { Sparkles, X, History, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DeckChangeView } from '@/types/dashboard';

export interface DeckVersionSummary {
  id: string;
  createdAt: string;
  origin: string;
  isActive: boolean;
}

interface DeckChangeBriefProps {
  changes: DeckChangeView[];
  versions?: DeckVersionSummary[];
  currentDeckId?: string;
  onRevert?: (deckId: string) => void;
  onDismiss: () => void;
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
 * The "what changed since yesterday" brief. Summarizes the reconciliation
 * (carried / new / moved off) and hosts the escape hatch — revert to an
 * earlier version of today's deck. Nothing here is a surprise: every change
 * is named, and every prior deck is one tap away.
 */
export function DeckChangeBrief({
  changes,
  versions = [],
  currentDeckId,
  onRevert,
  onDismiss,
}: DeckChangeBriefProps) {
  const [historyOpen, setHistoryOpen] = useState(false);

  const carried = changes.filter(c => c.kind === 'carried').length;
  const added = changes.filter(c => c.kind === 'added').length;
  const moved = changes.filter(c => c.kind === 'deferred' || c.kind === 'dropped' || c.kind === 'bumped').length;
  const fromCalendar = changes.some(c => c.source === 'calendar');

  const hasHistory = versions.length > 1;

  // Nothing to say and no history to offer — render nothing.
  if (changes.length === 0 && !hasHistory) return null;

  const parts: string[] = [];
  if (carried > 0) parts.push(`${carried} carried over`);
  if (added > 0) parts.push(`${added} new`);
  if (moved > 0) parts.push(`${moved} moved off`);
  const summary = parts.join(' · ');
  const lead = fromCalendar ? 'Adjusted for a calendar change' : 'Reconciled from your last deck';

  return (
    <div className="mb-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="flex items-start gap-2">
        <Sparkles className="w-3.5 h-3.5 text-primary/70 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-foreground/80 leading-relaxed">
            {summary
              ? <>{lead}: <span className="text-muted-foreground">{summary}</span>.</>
              : 'Earlier versions of today’s deck are available.'}
          </p>
          {hasHistory && (
            <button
              onClick={() => setHistoryOpen(o => !o)}
              className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <History className="w-2.5 h-2.5" />
              {historyOpen ? 'Hide earlier versions' : `Earlier versions (${versions.length})`}
            </button>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-muted-foreground/50 hover:text-foreground transition-colors shrink-0"
          title="Dismiss"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Earlier versions — the revert escape hatch */}
      {historyOpen && hasHistory && (
        <div className="mt-2 pt-2 border-t border-border/60 space-y-0.5">
          {versions.map(v => {
            const isCurrent = v.id === currentDeckId;
            return (
              <div
                key={v.id}
                className="flex items-center gap-2 py-1 text-[10px]"
              >
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
        </div>
      )}
    </div>
  );
}
