'use client';

import type { ReactNode } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useOrchestratorName } from '@/hooks/use-user-state';
import { OrchestratorAvatar } from '@/components/shared/orchestrator-mark';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/ui/tip';

/**
 * The top of the rail: the orchestrator, by the name and look the user gave
 * it, and the way home. Home is where the orchestrator lives (its chat on the
 * left, the deck on the right), so it is the home link rather than a separate
 * "Home" item. Highlighted while you're there.
 *
 * `action` sits at the right of the row in the wide rail (the collapse
 * toggle). In the collapsed rail the row folds to the avatar. The name and
 * look are changed in Settings, Profile.
 */
export function RailHome({ collapsed, action }: { collapsed: boolean; action?: ReactNode }) {
  const { activeView, goHome } = useDashboard();
  const name = useOrchestratorName();
  const isHome = activeView.kind === 'home';

  if (collapsed) {
    return (
      <div className="flex justify-center pt-2 pb-1">
        <Tip label={`${name} (Home)`}>
          <button
            type="button"
            onClick={goHome}
            aria-label={`${name}, home`}
            aria-current={isHome ? 'page' : undefined}
            className={cn(
              'rounded-lg p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              isHome ? 'ring-1 ring-primary/40' : 'hover:bg-muted/50',
            )}
          >
            <OrchestratorAvatar size="md" />
          </button>
        </Tip>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 px-2 pt-2 pb-1">
      <Tip label="Home">
        <button
          type="button"
          onClick={goHome}
          aria-current={isHome ? 'page' : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            isHome ? 'bg-muted/60' : 'hover:bg-muted/40',
          )}
        >
          <OrchestratorAvatar />
          <span className="truncate text-[13px] font-semibold text-foreground">{name}</span>
        </button>
      </Tip>
      {action}
    </div>
  );
}
