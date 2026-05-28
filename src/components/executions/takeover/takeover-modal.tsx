'use client';

import { useState } from 'react';
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui';
import { X, Copy, Check, ChevronDown, Loader2 } from 'lucide-react';
import { useTakeover } from '@/hooks/use-takeover';
import { ApiError } from '@/lib/api/client';
import type { TakeoverResponse } from '@/lib/api/sessions';
import { cn } from '@/lib/utils';

interface TakeoverModalProps {
  sessionId: string;
  data: TakeoverResponse;
  onClose: () => void;
}

/**
 * Browser-side modal users see after clicking "Take over locally."
 * Primary surface is a single `flow takeover <url>` command with a
 * copy button. Secondary surface (collapsible) is the manual git
 * commands for users without the CLI installed.
 *
 * Resume happens either via `flow resume` on the laptop (preferred,
 * pushes from the local clone) OR the "Done — pull my changes" button
 * here (assumes the user already pushed from elsewhere).
 */
export function TakeoverModal({ sessionId, data, onClose }: TakeoverModalProps) {
  const { resume, cancel } = useTakeover(sessionId);
  const [showFallback, setShowFallback] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const handleResume = () => {
    setResumeError(null);
    resume.mutate(data.token, {
      onSuccess: () => onClose(),
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) {
          const body = err.body as { message?: string } | null;
          setResumeError(body?.message ?? 'Pull conflict on the host.');
          return;
        }
        setResumeError(err instanceof Error ? err.message : String(err));
      },
    });
  };

  const handleCancel = () => {
    if (
      !confirm(
        'Cancel this takeover? The remote branch and any local clone are left as-is. The agent resumes from where it was paused.',
      )
    )
      return;
    setCancelError(null);
    cancel.mutate(undefined, {
      onSuccess: () => onClose(),
      onError: (err) => setCancelError(err instanceof Error ? err.message : String(err)),
    });
  };

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>Take over locally</DialogPrimitive.Title>
            <DialogPrimitive.Description>
              Copy the command into your laptop terminal to clone the workspace and pick up where the agent left off.
            </DialogPrimitive.Description>
          </VisuallyHidden.Root>
          <div className="bg-popover border border-border rounded-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-[14px] font-semibold text-foreground">Take over locally</h2>
              <DialogPrimitive.Close asChild>
                <button
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </DialogPrimitive.Close>
            </div>

            <div className="px-4 py-4 space-y-4">
              <div>
                <div className="text-[11px] text-muted-foreground/85 mb-1.5">
                  Branch <span className="font-mono text-foreground/85">{data.branch}</span> has been
                  pushed to <span className="font-mono text-foreground/85">{data.remoteUrl}</span>.
                  Run this on your laptop to clone, check out, and open the workspace:
                </div>
                <CommandBlock command={data.cliCommand} />
                <div className="text-[10.5px] text-muted-foreground/70 mt-1.5">
                  Token expires {new Date(data.expiresAt).toLocaleString()}.
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowFallback((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown
                  size={11}
                  className={cn('transition-transform', showFallback ? 'rotate-0' : '-rotate-90')}
                />
                Don&apos;t have the CLI?
              </button>
              {showFallback && (
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2 text-[11px]">
                  <div className="text-muted-foreground/85">
                    Manual path — clone the repo (if needed) and check out the branch yourself, then push
                    and click <em>Done</em> below.
                  </div>
                  <CommandBlock command={data.fallbackCommand} small />
                </div>
              )}

              <div className="border-t border-border pt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={cancel.isPending}
                  className="px-2.5 py-1 text-[11.5px] rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-60"
                >
                  Cancel takeover
                </button>
                <button
                  type="button"
                  onClick={handleResume}
                  disabled={resume.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {resume.isPending && <Loader2 size={11} className="animate-spin" />}
                  Done — pull my changes
                </button>
              </div>

              {resumeError && (
                <div className="text-[11px] text-destructive">{resumeError}</div>
              )}
              {cancelError && (
                <div className="text-[11px] text-destructive">{cancelError}</div>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function CommandBlock({ command, small }: { command: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* ignore — older browsers, security ctx */
      });
  };

  return (
    <div
      className={cn(
        'group flex items-center justify-between gap-2 rounded-md border border-border bg-muted/50 px-3',
        small ? 'py-1' : 'py-2',
      )}
    >
      <code
        className={cn(
          'font-mono break-all text-foreground flex-1 min-w-0',
          small ? 'text-[10.5px]' : 'text-[11.5px]',
        )}
      >
        {command}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
        title={copied ? 'Copied' : 'Copy'}
        aria-label={copied ? 'Copied' : 'Copy command'}
      >
        {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
      </button>
    </div>
  );
}
