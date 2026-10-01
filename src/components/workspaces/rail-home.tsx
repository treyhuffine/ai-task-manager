'use client';

import { Pencil } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useOrchestratorName } from '@/hooks/use-user-state';
import { OrchestratorAvatar } from '@/components/shared/orchestrator-mark';
import { openIdentityDialog } from '@/components/orchestrator/identity-dialog';
import { cn } from '@/lib/utils';

/**
 * The top of the rail: the orchestrator, by the name and look the user gave
 * it, and the way home. Home is where the orchestrator lives (its chat on the
 * left, the deck on the right), so it is the home link rather than a separate
 * "Home" item. Highlighted while you're there.
 *
 * Its name and look change from a quiet pencil on hover (the same editor as
 * Settings, Profile, and the main chat's first run). In the skinny rail it
 * folds to its avatar.
 */
export function RailHome({ collapsed }: { collapsed: boolean }) {
  const { activeView, goHome } = useDashboard();
  const name = useOrchestratorName();
  const isHome = activeView.kind === 'home';

  if (collapsed) {
    return (
      <div className="flex justify-center pt-2 pb-1">
        <button
          type="button"
          onClick={goHome}
          aria-label={`${name}, home`}
          aria-current={isHome ? 'page' : undefined}
          title={`${name} (Home)`}
          className={cn(
            'rounded-lg p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            isHome ? 'ring-1 ring-primary/40' : 'hover:bg-muted/50',
          )}
        >
          <OrchestratorAvatar size="md" />
        </button>
      </div>
    );
  }

  return (
    <div className="px-2 pt-2">
      <div
        className={cn(
          'group/home flex items-center rounded-md transition-colors',
          isHome ? 'bg-muted/60' : 'hover:bg-muted/40',
        )}
      >
        <button
          type="button"
          onClick={goHome}
          aria-current={isHome ? 'page' : undefined}
          title="Home"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <OrchestratorAvatar />
          <span className="truncate text-[13px] font-semibold text-foreground">{name}</span>
        </button>
        <button
          type="button"
          onClick={openIdentityDialog}
          aria-label={`Change ${name}'s name and look`}
          title="Change name and look"
          className="mr-1 rounded p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/home:opacity-100"
        >
          <Pencil size={11} />
        </button>
      </div>
    </div>
  );
}
