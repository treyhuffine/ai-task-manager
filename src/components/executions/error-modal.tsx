'use client';

import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import { X, Loader2, AlertCircle, Sparkles } from 'lucide-react';

export interface ErrorModalAction {
  label: string;
  onClick: () => void;
  pending?: boolean;
  /** Hint text shown alongside the action; e.g. "Sends the error to the chat". */
  hint?: string;
}

interface ErrorModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Free-text error body. Rendered in a monospace block so stderr is legible. */
  message: string;
  /** Optional CTA — usually "Solve with agent" which dispatches a help prompt. */
  action?: ErrorModalAction;
}

/**
 * Generic error modal for action-bar failures. Replaces `alert()` so the
 * user gets a readable, optionally-actionable surface for things like
 * `git fetch` 400s and `gh` quirks. When `action` is provided, the
 * primary button forwards control to the agent — same pattern as the
 * other prompt-injection affordances on the bar.
 */
export function ErrorModal({ open, onClose, title, message, action }: ErrorModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description>{message}</DialogPrimitive.Description>
          </VisuallyHidden.Root>
          <div className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-rose-700 dark:text-rose-400">
                <AlertCircle size={13} />
                {title}
              </span>
              <DialogPrimitive.Close asChild>
                <button className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <X size={16} />
                </button>
              </DialogPrimitive.Close>
            </div>

            <div className="p-5">
              <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] font-mono leading-snug text-foreground whitespace-pre-wrap break-words">
                {message}
              </pre>
              {action?.hint && (
                <p className="mt-2 text-[11px] text-muted-foreground">{action.hint}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
              <DialogPrimitive.Close asChild>
                <button className="px-4 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors">
                  Dismiss
                </button>
              </DialogPrimitive.Close>
              {action && (
                <button
                  onClick={() => {
                    action.onClick();
                  }}
                  disabled={action.pending}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {action.pending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  {action.label}
                </button>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
