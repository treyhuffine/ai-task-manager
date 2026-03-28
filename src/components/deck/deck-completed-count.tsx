"use client";

import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { DeckItem } from '@/types/dashboard';

interface DeckCompletedCountProps {
  completedItems: DeckItem[];
  expanded: boolean;
  onToggle: () => void;
}

export function DeckCompletedCount({ completedItems, expanded, onToggle }: DeckCompletedCountProps) {
  if (completedItems.length === 0) return null;

  return (
    <div className="mb-2">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-left py-2"
      >
        <Check className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="text-xs text-muted-foreground/60">
          {completedItems.length} completed today
        </span>
        {expanded
          ? <ChevronDown className="w-3 h-3 text-muted-foreground/40" />
          : <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
        }
      </button>

      {expanded && (
        <div className="ml-5.5 space-y-1 pb-2">
          {completedItems.map(item => (
            <div key={item.id} className="text-xs text-muted-foreground/40 line-through">
              {item.parentTitle && <>{item.parentTitle} · </>}
              {item.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
