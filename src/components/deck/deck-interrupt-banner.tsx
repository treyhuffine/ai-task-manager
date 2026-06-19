"use client";

import { AlertTriangle, X } from 'lucide-react';
import type { DeckChangeView } from '@/types/dashboard';

interface DeckInterruptBannerProps {
  interrupts: DeckChangeView[];
  onRestore: (taskId: string) => void;
  onDismiss: () => void;
}

/**
 * The rare interrupt surface — a priority banner. The change-router only routes
 * here when a change both needs a decision only the user can make and can't
 * wait (e.g. a hard-deadline task got squeezed off the deck by a new meeting).
 * Always reversible: "Keep it today" restores it.
 */
export function DeckInterruptBanner({ interrupts, onRestore, onDismiss }: DeckInterruptBannerProps) {
  if (interrupts.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            Needs your call
          </p>
          <div className="mt-1 space-y-1.5">
            {interrupts.map((c) => (
              <div key={`int-${c.taskId}`} className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] text-foreground/90">{c.title}</span>
                  {c.reason && (
                    <span className="text-[10px] text-muted-foreground"> — {c.reason}</span>
                  )}
                </div>
                <button
                  onClick={() => onRestore(c.taskId)}
                  className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/15 transition-colors"
                >
                  Keep it today
                </button>
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-amber-600/60 hover:text-amber-700 dark:hover:text-amber-300 transition-colors shrink-0"
          title="Dismiss"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
