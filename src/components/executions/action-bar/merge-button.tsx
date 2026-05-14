'use client';

import { useState } from 'react';
import { GitMerge, AlertTriangle } from 'lucide-react';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import { ActionButton } from './action-button';
import { useMergePr } from '@/hooks/use-execution-actions';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MergeButtonProps {
  sessionId: string;
  prNumber: number;
  prUrl: string;
  /** When false, the button renders greyed with a tooltip explaining why. */
  enabled: boolean;
  /** Reason shown in the tooltip + confirm dialog when not enabled. */
  reason?: string;
  variant?: 'primary' | 'secondary';
}

const METHODS: ReadonlyArray<{ value: 'squash' | 'merge' | 'rebase'; label: string }> = [
  { value: 'squash', label: 'Squash and merge' },
  { value: 'merge', label: 'Create a merge commit' },
  { value: 'rebase', label: 'Rebase and merge' },
];

/**
 * Merge button + confirm dialog. Pops a quick "Merge method" prompt so
 * users can pick between squash/merge/rebase; defaults to squash. The
 * dialog also surfaces any blocking reason when `enabled` is false
 * (e.g. PR not mergeable).
 */
export function MergeButton({
  sessionId,
  prNumber,
  prUrl,
  enabled,
  reason,
  variant = 'primary',
}: MergeButtonProps) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<'squash' | 'merge' | 'rebase'>('squash');
  const [error, setError] = useState<string | null>(null);
  const merge = useMergePr(sessionId);

  const handleMerge = () => {
    setError(null);
    merge.mutate(
      { method, deleteBranch: true },
      {
        onSuccess: () => {
          setOpen(false);
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            const body = err.body as { message?: string; error?: string } | null;
            setError(body?.message ?? body?.error ?? `Merge failed (${err.status})`);
          } else {
            setError(err instanceof Error ? err.message : String(err));
          }
        },
      },
    );
  };

  return (
    <>
      <ActionButton
        icon={<GitMerge size={11} />}
        label={`Merge #${prNumber}`}
        onClick={() => setOpen(true)}
        disabled={!enabled}
        variant={variant}
        title={enabled ? `Merge PR #${prNumber}` : reason ?? 'Merge unavailable'}
      />
      <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <VisuallyHidden.Root>
              <DialogPrimitive.Title>Merge PR #{prNumber}</DialogPrimitive.Title>
              <DialogPrimitive.Description>Confirm merge of pull request</DialogPrimitive.Description>
            </VisuallyHidden.Root>
            <div className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <GitMerge size={14} className="text-primary" />
                  <span className="text-[13px] font-semibold text-foreground">
                    Merge PR #{prNumber}
                  </span>
                </div>
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {prUrl}
                </a>
              </div>

              <div className="px-5 py-4 space-y-3">
                {!enabled && reason && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                    <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                    <span>{reason}</span>
                  </div>
                )}

                <fieldset className="space-y-1.5">
                  <legend className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground mb-1">
                    Merge method
                  </legend>
                  {METHODS.map((m) => (
                    <label
                      key={m.value}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1.5 rounded-md border text-[12px] cursor-pointer',
                        method === m.value
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-border hover:bg-muted/30',
                      )}
                    >
                      <input
                        type="radio"
                        name="merge-method"
                        checked={method === m.value}
                        onChange={() => setMethod(m.value)}
                        className="accent-primary"
                      />
                      {m.label}
                    </label>
                  ))}
                </fieldset>

                {error && (
                  <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-700 dark:text-rose-300">
                    {error}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-3 py-1.5 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleMerge}
                  disabled={!enabled || merge.isPending}
                  className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {merge.isPending ? 'Merging…' : 'Merge'}
                </button>
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
