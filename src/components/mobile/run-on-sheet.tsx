'use client';

/**
 * Where a new execution starts, when it isn't the usual place (spec §3.3,
 * P3.1 on the phone). A plain + starts on the agent's default, the home
 * unless it was changed, with nothing to decide. "New execution on…" in the
 * agent's ⋯ menu opens this: each computer that can take the agent's work,
 * the default marked, and Make this the default as its own action. Picking one starts that one execution
 * there and changes nothing else.
 */

import { Check, Laptop, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useRunOn, useSetDefaultComputer } from '@/hooks/use-workspaces';
import { cn } from '@/lib/utils';

export function RunOnSheet({
  workspace,
  open,
  onOpenChange,
  onPick,
}: {
  workspace: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (computerId: string) => void;
}) {
  const { data: runOn, isLoading } = useRunOn(open ? workspace.id : null);
  const setDefault = useSetDefaultComputer(workspace.id);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className="rounded-t-2xl px-5 pb-8 pt-4">
        <div className="mx-auto mb-4 h-1 w-8 rounded-full bg-muted-foreground/30" />
        <SheetTitle className="mb-2 text-[15px] font-semibold">New execution in {workspace.name}, on…</SheetTitle>
        {isLoading || !runOn ? (
          <p className="flex items-center gap-2 py-4 text-[13px] text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Checking where it can run…
          </p>
        ) : (
          <ul className="space-y-1">
            {runOn.choices.map((choice) => {
              const isDefault = choice.computerId === runOn.defaultId;
              return (
                <li key={choice.computerId} className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!choice.ready}
                    onClick={() => onPick(choice.computerId)}
                    className={cn(
                      'flex flex-1 items-start gap-3 rounded-xl px-3 py-2.5 text-left active:bg-muted/60 disabled:opacity-50',
                      isDefault && 'bg-muted/40',
                    )}
                  >
                    <Laptop size={16} className="mt-0.5 flex-shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium text-foreground">
                        {choice.name}
                        {isDefault && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">default</span>}
                      </span>
                      <span className="block text-[12px] text-muted-foreground">
                        {!choice.ready
                          ? choice.problem ?? "Can't take this work yet."
                          : !choice.connected
                            ? "Not connected: it'll start when it's back."
                            : choice.isHome
                              ? 'The home'
                              : 'Ready'}
                      </span>
                    </span>
                    {isDefault && <Check size={15} className="mt-0.5 text-foreground/70" />}
                  </button>
                  {!isDefault && choice.ready && (
                    <button
                      type="button"
                      disabled={setDefault.isPending}
                      onClick={() => setDefault.mutate(choice.computerId)}
                      className="flex-shrink-0 rounded-lg px-2 py-1.5 text-[12px] text-primary active:bg-primary/10 disabled:opacity-50"
                    >
                      Make default
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
