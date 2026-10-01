'use client';

import { useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { useDashboard } from '@/contexts/dashboard-context';
import { useOrchestratorName, useUpdateUserState } from '@/hooks/use-user-state';
import { apiErrorText } from '@/lib/api/client';
import {
  DEFAULT_ORCHESTRATOR_NAME,
  normalizeOrchestratorName,
  ORCHESTRATOR_NAME_MAX,
} from '@/lib/orchestrator/name';
import { OrchestratorMark } from '@/components/shared/orchestrator-mark';
import { cn } from '@/lib/utils';

/**
 * The top of the rail: the orchestrator, by the name the user calls it, and
 * the way home. Home is where the orchestrator lives (its chat on the left,
 * the deck on the right), so its name is the home link rather than a separate
 * "Home" item. Highlighted while you're there.
 *
 * Renaming is a quiet pencil on hover, the same as Settings, Profile. In the
 * skinny rail the name folds to its initial.
 */
export function RailHome({ collapsed }: { collapsed: boolean }) {
  const { activeView, goHome } = useDashboard();
  const name = useOrchestratorName();
  const isHome = activeView.kind === 'home';
  const [renaming, setRenaming] = useState(false);

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
          <OrchestratorMark name={name} size="md" />
        </button>
      </div>
    );
  }

  return (
    <div className="px-2 pt-2">
      {renaming ? (
        <RenameField current={name} onDone={() => setRenaming(false)} />
      ) : (
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
            <OrchestratorMark name={name} />
            <span className="truncate text-[13px] font-semibold text-foreground">{name}</span>
          </button>
          <button
            type="button"
            onClick={() => setRenaming(true)}
            aria-label={`Rename ${name}`}
            title="Rename"
            className="mr-1 rounded p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/home:opacity-100"
          >
            <Pencil size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The name, editable in place. Enter or leaving the field saves, Escape keeps
 * the old name. Clearing it goes back to the default, which the placeholder
 * shows.
 */
function RenameField({ current, onDone }: { current: string; onDone: () => void }) {
  const update = useUpdateUserState();
  const [value, setValue] = useState(current);
  // Enter saves and unmounts the field, which blurs it: save once.
  const settled = useRef(false);

  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    onDone();
    if (!save) return;
    const next = normalizeOrchestratorName(value);
    if ((next ?? DEFAULT_ORCHESTRATOR_NAME) === current) return;
    update.mutate(
      { orchestratorName: next },
      {
        onError: (err) => toast.error(`Couldn’t rename ${current}`, { description: apiErrorText(err) }),
      },
    );
  };

  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/60 px-1.5 py-1.5 ring-1 ring-primary/40">
      <OrchestratorMark name={normalizeOrchestratorName(value) ?? DEFAULT_ORCHESTRATOR_NAME} />
      <input
        autoFocus
        value={value}
        maxLength={ORCHESTRATOR_NAME_MAX}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(true);
          } else if (e.key === 'Escape') {
            // Escape here only leaves the field, never closes what's behind it.
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          }
        }}
        placeholder={DEFAULT_ORCHESTRATOR_NAME}
        aria-label="Orchestrator name"
        className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  );
}
