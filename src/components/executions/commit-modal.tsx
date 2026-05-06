'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import { X, Loader2 } from 'lucide-react';
import { useCommit } from '@/hooks/use-execution';
import { ApiError } from '@/lib/api/client';

interface CommitModalProps {
  sessionId: string | null;
  onClose: () => void;
}

/**
 * v1 commit modal: user types a message, library commits via
 * `@agentex/workspace`'s `ws.git.commit()`. The "agent drafts the
 * message" path (Pattern 2 in the tool/agentic split) lands when the
 * agent layer wires up; for now this is plain Pattern 1.
 */
export function CommitModal({ sessionId, onClose }: CommitModalProps) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commit = useCommit(sessionId ?? '');

  useEffect(() => {
    if (sessionId) {
      setMessage('');
      setError(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [sessionId]);

  const handleSubmit = () => {
    if (!sessionId || !message.trim() || commit.isPending) return;
    setError(null);
    commit.mutate(message.trim(), {
      onSuccess: () => onClose(),
      onError: (err) => {
        if (err instanceof ApiError) {
          const body = err.body as { message?: string; error?: string } | null;
          setError(body?.message ?? body?.error ?? `Commit failed (${err.status})`);
        } else {
          setError(String(err));
        }
      },
    });
  };

  return (
    <DialogPrimitive.Root open={!!sessionId} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Commit changes</DialogPrimitive.Title>
            <DialogPrimitive.Description>Commit changes in this worktree</DialogPrimitive.Description>
          </VisuallyHidden.Root>
          <div className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <span className="text-xs font-semibold tracking-wide text-foreground">
                Commit changes
              </span>
              <DialogPrimitive.Close asChild>
                <button className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <X size={16} />
                </button>
              </DialogPrimitive.Close>
            </div>

            <div className="p-5">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Message
              </label>
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder="What did you change?"
                rows={4}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
              <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                Stages everything (tracked + untracked) and commits. ⌘↵ to submit.
              </p>
              {error && (
                <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
              <DialogPrimitive.Close asChild>
                <button className="px-4 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors">
                  Cancel
                </button>
              </DialogPrimitive.Close>
              <button
                onClick={handleSubmit}
                disabled={!message.trim() || commit.isPending}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {commit.isPending && <Loader2 size={14} className="animate-spin" />}
                Commit
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
