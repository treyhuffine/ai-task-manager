'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Loader2 } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { openLauncher } from '@/components/workspaces/launcher/launcher-store';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface TaskLike {
  id: string;
  title: string;
  status: string;
  workspaceId?: string | null;
  description?: string | null;
  body?: string | null;
  bodyExcerpt?: string | null;
}

type ContinueTarget = { executionId: string; sessionId: string; label: string | null };

/**
 * "Start with agent" (Consider/Todo) or "Continue with agent" (In progress).
 *
 * Start opens the launcher pre-seeded with this task; on launch the server
 * associates + Starts it atomically. Continue reuses the workstream already
 * associated with the In-progress task: no associated execution opens the
 * launcher (a fresh one), exactly one resumes it, and several open a chooser.
 * Archived executions are history, never automatic Continue targets.
 */
export function StartWithAgentButton({
  task,
  variant = 'button',
  className,
}: {
  task: TaskLike;
  variant?: 'button' | 'icon' | 'menuitem';
  className?: string;
}) {
  const router = useRouter();
  const live = task.status === 'in_progress';
  const label = live ? 'Continue with agent' : 'Start with agent';
  const [busy, setBusy] = useState(false);
  const [chooser, setChooser] = useState<ContinueTarget[] | null>(null);

  const launchNew = () => {
    const fullBody = (task.body ?? '').trim();
    const excerpt = (task.bodyExcerpt ?? '').trim();
    const desc = (task.description ?? '').trim();
    // The complete body IS the spec, never replaced by a short description.
    const spec = fullBody || excerpt;
    const reference =
      `You are working on task "${task.title}" (durable id ${task.id}, reference it as [[task:${task.id}]]). ` +
      `Use get_task for the complete spec, and complete_task / transition_task to change its lifecycle.`;
    const contextBody = [reference, desc, spec].filter((s, i, arr) => s && arr.indexOf(s) === i).join('\n\n');
    openLauncher({ taskId: task.id, workspaceId: task.workspaceId ?? undefined, contextTitle: task.title, contextBody });
  };

  const openExecution = (sessionId: string) => router.push(`/?session=${sessionId}`);

  const onClick = async () => {
    // Start (Consider/Todo): always a new execution via the launcher.
    if (!live) return launchNew();
    // Continue (In progress): reuse the associated workstream.
    setBusy(true);
    try {
      const targets = await api.get<ContinueTarget[]>(`/tasks/${task.id}/continue-targets`);
      if (targets.length === 0) launchNew();
      else if (targets.length === 1) openExecution(targets[0].sessionId);
      else setChooser(targets);
    } catch {
      launchNew(); // if we can't check, fall back to the launcher
    } finally {
      setBusy(false);
    }
  };

  const chooserDialog = (
    <Dialog.Root open={!!chooser} onOpenChange={(o) => !o && setChooser(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-xl focus:outline-none">
          <Dialog.Title className="text-sm font-semibold text-foreground">Continue which workstream?</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-muted-foreground">
            Several agent workstreams are working this task. Resume one, or start another.
          </Dialog.Description>
          <div className="mt-3 space-y-1.5">
            {(chooser ?? []).map((t) => (
              <button
                key={t.executionId}
                onClick={() => { setChooser(null); openExecution(t.sessionId); }}
                className="flex w-full items-center gap-2 rounded border border-border px-2.5 py-2 text-left text-xs hover:border-violet-500/50 hover:bg-violet-500/[0.06]"
              >
                <Bot size={13} className="flex-shrink-0 text-violet-500" />
                <span className="truncate text-foreground">{t.label || 'Agent workstream'}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex justify-between">
            <button onClick={() => { setChooser(null); launchNew(); }} className="rounded px-3 py-1.5 text-xs font-medium text-violet-600 hover:bg-violet-500/10 dark:text-violet-400">
              Start another execution
            </button>
            <button onClick={() => setChooser(null)} className="rounded px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              Cancel
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );

  if (variant === 'icon') {
    return (
      <>
        <button
          title={label}
          aria-label={label}
          onClick={onClick}
          disabled={busy}
          className={cn('flex h-7 w-7 items-center justify-center rounded text-violet-600 hover:bg-violet-500/10 disabled:opacity-60 dark:text-violet-400', className)}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
        </button>
        {chooserDialog}
      </>
    );
  }

  if (variant === 'menuitem') {
    return (
      <>
        <button
          onClick={onClick}
          disabled={busy}
          className={cn('flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent disabled:opacity-60', className)}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} className="text-violet-500" />}
          {label}
        </button>
        {chooserDialog}
      </>
    );
  }

  return (
    <>
      <button
        onClick={onClick}
        disabled={busy}
        className={cn(
          'inline-flex items-center gap-1.5 rounded border border-violet-500/30 bg-violet-500/5 px-2 py-1 text-[11px] font-medium text-violet-600 transition-colors hover:bg-violet-500/10 disabled:opacity-60 dark:text-violet-400',
          className,
        )}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />}
        {label}
      </button>
      {chooserDialog}
    </>
  );
}
