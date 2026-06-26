'use client';

import { useState } from 'react';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import { X, Zap, Loader2 } from 'lucide-react';
import { useCreateExecution, useUpdateWorkspace } from '@/hooks/use-workspaces';
import { useDashboard } from '@/contexts/dashboard-context';

interface LiveModeModalProps {
  workspaceId: string | null;
  workspaceName: string | null;
  onClose: () => void;
}

/**
 * Explainer + confirm for Live mode session creation. Live skips the
 * worktree dance entirely — the agent runs in the workspace's actual
 * folder on whatever branch is currently checked out. Faster, no
 * isolation, designed for solo projects where the user just wants to
 * push directly.
 */
export function LiveModeModal({ workspaceId, workspaceName, onClose }: LiveModeModalProps) {
  const create = useCreateExecution();
  const updateWorkspace = useUpdateWorkspace();
  const { setActiveView } = useDashboard();
  const [error, setError] = useState<string | null>(null);
  const [dontAsk, setDontAsk] = useState(false);

  const handleStart = () => {
    if (!workspaceId || create.isPending) return;
    setError(null);
    // Persist the per-workspace opt-out at the moment the user actually
    // starts a Live session — not on cancel. Fire-and-forget: the choice
    // shouldn't block dropping into the session, and the next Zap click
    // reads the fresh flag once the workspaces cache invalidates.
    if (dontAsk) {
      updateWorkspace.mutate({ id: workspaceId, skipLiveConfirm: true });
    }
    create.mutate(
      { workspaceId, liveMode: true },
      {
        onSuccess: (session) => {
          setActiveView(session.id);
          onClose();
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : String(err));
        },
      },
    );
  };

  return (
    <DialogPrimitive.Root open={!!workspaceId} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Start a Live session</DialogPrimitive.Title>
            <DialogPrimitive.Description>
              Live skips worktrees and runs the agent in the workspace folder on the current branch.
            </DialogPrimitive.Description>
          </VisuallyHidden.Root>
          <div className="bg-popover border border-border rounded-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Zap size={14} className="text-amber-500" />
                <h2 className="text-[14px] font-semibold text-foreground">
                  Live session
                  {workspaceName && (
                    <span className="text-muted-foreground/70 font-normal"> · {workspaceName}</span>
                  )}
                </h2>
              </div>
              <DialogPrimitive.Close asChild>
                <button
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </DialogPrimitive.Close>
            </div>

            <div className="px-4 py-4 space-y-3 text-[12px] leading-relaxed">
              <p className="text-foreground/90">
                Live mode skips the worktree dance. The agent runs in your{' '}
                <span className="font-medium">actual workspace folder</span>, on whatever branch is
                currently checked out. Commits land directly on that branch.
              </p>
              <ul className="text-muted-foreground/85 space-y-1 pl-4 list-disc">
                <li>
                  No isolation: your local edits and the agent&apos;s edits share one working tree.
                </li>
                <li>
                  If you&apos;re on <code className="font-mono text-foreground/85">main</code>, you
                  push to <code className="font-mono text-foreground/85">main</code>. No PR by
                  default.
                </li>
                <li>
                  Two Live sessions on the same workspace will race on files. Don&apos;t do that.
                </li>
                <li>
                  Archiving a Live session won&apos;t delete your project, just the session row.
                </li>
              </ul>
              <p className="text-foreground/85">
                Use it when you&apos;re moving fast on a solo project and don&apos;t want the
                worktree overhead. Otherwise, stick with a regular session. yolo.
              </p>
              {error && <div className="text-[11px] text-destructive">{error}</div>}
            </div>

            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border bg-muted/30">
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={dontAsk}
                  onChange={(e) => setDontAsk(e.target.checked)}
                  className="size-3 rounded-sm accent-amber-500 cursor-pointer"
                />
                Don&apos;t ask again for this workspace
              </label>
              <div className="flex items-center gap-2">
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  className="px-3 py-1 text-[12px] rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                >
                  Cancel
                </button>
              </DialogPrimitive.Close>
              <button
                type="button"
                onClick={handleStart}
                disabled={!workspaceId || create.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium rounded bg-amber-500 text-white hover:bg-amber-500/90 transition-colors disabled:opacity-60"
              >
                {create.isPending ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Zap size={11} />
                )}
                Start Live session
              </button>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
