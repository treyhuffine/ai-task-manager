'use client';

/**
 * Continue on MacBook (docs/homes-spec.md §8.2, P4.2): what the move does,
 * what it takes, and the one choice it asks for. Tracked changes always go,
 * committed and pushed with Git. Untracked files go only when chosen. Local
 * setup and secrets never do.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useStartTransfer, useWorkingState } from '@/hooks/use-execution';
import { apiErrorText } from '@/lib/api/client';

export function ContinueDialog({
  sessionId,
  open,
  onOpenChange,
  to,
  from,
}: {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  to: { computerId: string; name: string };
  from: string;
}) {
  const { data: state, isLoading, error } = useWorkingState(sessionId, open);
  const start = useStartTransfer(sessionId);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const toggle = (file: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });

  const go = () =>
    start.mutate(
      { toComputerId: to.computerId, includeUntracked: [...chosen] },
      { onSuccess: () => onOpenChange(false) },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Continue on {to.name}</DialogTitle>
          <DialogDescription>
            The agent stops on {from}. Its work is committed and pushed with Git, and the same execution continues on {to.name}
            in a fresh session that starts from a handoff. The chat stays as it is, and {from} keeps its folder.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-[12.5px]">
          {isLoading ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> Looking at the work on {from}…
            </p>
          ) : error ? (
            <p className="text-destructive">{apiErrorText(error)}</p>
          ) : state ? (
            <>
              <p className="text-muted-foreground">
                {state.changed.length > 0
                  ? `${state.changed.length} changed ${state.changed.length === 1 ? 'file goes' : 'files go'} along, on ${state.branch ?? 'its branch'}.`
                  : `No uncommitted changes. ${state.branch ?? 'Its branch'} goes as it is.`}
              </p>
              {state.untracked.length > 0 && (
                <fieldset className="space-y-1.5">
                  <legend className="mb-1 font-medium text-foreground">New files to take along</legend>
                  <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                    {state.untracked.map((file) => (
                      <label key={file} className="flex cursor-pointer items-center gap-2 font-mono text-[11.5px]">
                        <Checkbox checked={chosen.has(file)} onCheckedChange={() => toggle(file)} />
                        <span className="truncate">{file}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground/80">Files you leave unchecked stay on {from}.</p>
                </fieldset>
              )}
              {state.localOnly.length > 0 && (
                <p className="text-[11px] text-muted-foreground/80">
                  Staying on {from}: {state.localOnly.join(', ')}. Local setup and secrets never move. {to.name} uses its own.
                </p>
              )}
            </>
          ) : null}
          {start.error && <p className="text-destructive">{apiErrorText(start.error)}</p>}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border px-3 py-1.5 text-[12.5px] hover:bg-muted/60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={go}
            disabled={start.isPending || isLoading || !!error}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {start.isPending && <Loader2 size={12} className="animate-spin" />}
            Continue on {to.name}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
