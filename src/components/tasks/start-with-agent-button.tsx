'use client';
import { teamDisplayName } from '@/lib/home/team-display-name';

import { openLauncher } from '@/components/workspaces/launcher/launcher-store';
import { trpcClient } from '@/lib/trpc/client';
import { ENTITY_HEADER_LABEL } from '@/components/entities/entity-header';
import { cn } from '@/lib/utils';
import { Bot, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Dialog } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import { Tip } from '@/components/ui/tip';
import { useConnectedTeams } from '@/components/spaces/space-selector';
import { useOptionalWorkNavigation } from '@/contexts/work-context';

import { taskLauncherSeed, type TaskLike } from './task-launcher-seed';

type ContinueTarget = { executionId: string; sessionId: string; label: string | null };

/**
 * "Start with agent" (Consider/Todo) or "Continue with agent" (In progress).
 *
 * Start opens the launcher pre-seeded with this task; on launch the server
 * associates + Starts it atomically. Continue reuses the workstream already
 * associated with the In-progress task: no associated execution opens the
 * launcher (a fresh one), exactly one resumes it, and several open a chooser.
 * Archived executions are history, never automatic Continue targets.
 *
 * On a task shared with a team it's "Work with agent" (docs/homes-spec.md
 * §9.5). Starting moves nothing at the team, so status can't say whether
 * work is underway here: it always looks for this person's own executions
 * on the task first. The brief says whose text is whose, and that the
 * team's status and publishing are the person's call.
 */
export function StartWithAgentButton({
  task,
  variant = 'button',
  className,
  label: contextualLabel,
  autoOpen = false, onHandled, onCancel,
}: {
  task: TaskLike;
  variant?: 'button' | 'icon' | 'menuitem';
  className?: string;
  label?: string;
  autoOpen?: boolean; onHandled?: () => void; onCancel?: () => void;
}) {
  const router = useRouter();
  // Each owning document mounts the common launcher. Standalone task pages
  // navigate to their personal dashboard only when no work context exists.
  const navigation = useOptionalWorkNavigation();
  const shared = !!task.sourceTeamId;
  const teams = useConnectedTeams(shared);
  const teamName = shared ? teamDisplayName(task.sourceTeamId!, teams.data) : 'the team';
  const live = shared || task.status === 'in_progress';
  const label = contextualLabel ?? (shared ? 'Work with agent' : live ? 'Continue with agent' : 'Start with agent');
  const [busy, setBusy] = useState(false);
  const [chooser, setChooser] = useState<ContinueTarget[] | null>(null);

  const launchNew = () => {
    openLauncher({ ...taskLauncherSeed(task, teamName), onCancel });
    // From the standalone task page, the launcher opens in the dashboard with
    // this task: its store keeps the seed across the client navigation.
    if (!navigation) router.push('/');
    onHandled?.();
  };

  const openExecution = (sessionId: string) => { if (navigation) navigation.openExecution(sessionId); else router.push(`/?session=${sessionId}`); onHandled?.(); };

  const onClick = async () => {
    // Start (Consider/Todo): always a new execution via the launcher.
    if (!live) return launchNew();
    // Continue (In progress, or any shared task): reuse the associated workstream.
    setBusy(true);
    try {
      const targets = await trpcClient.tasks.continueTargetsGet.query({params: {id: task.id}});
      if (targets.length === 0) launchNew();
      else if (targets.length === 1) openExecution(targets[0].sessionId);
      else setChooser(targets);
    } catch (error) {
      toast.error(`Could not check existing chats. Try again. ${apiErrorText(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || opened.current) return;
    opened.current = true;
    void onClick();
  });

  const chooserDialog = (
    <Dialog.Root open={!!chooser} onOpenChange={(o) => { if (!o) { setChooser(null); onCancel?.(); onHandled?.(); } }}>
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
            <button onClick={() => { setChooser(null); onCancel?.(); onHandled?.(); }} className="rounded px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
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
        <Tip label={label}>
          <button
            aria-label={label}
            onClick={onClick}
            disabled={busy}
            className={cn('flex h-7 w-7 items-center justify-center rounded text-violet-600 hover:bg-violet-500/10 disabled:opacity-60 dark:text-violet-400', className)}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
          </button>
        </Tip>
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
      <Tip label={label} onlyWhenTextHidden>
        <button
          onClick={onClick}
          disabled={busy}
          aria-label={label}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-violet-500/30 bg-violet-500/5 px-2 py-1 text-[11px] font-medium text-violet-600 transition-colors hover:bg-violet-500/10 disabled:opacity-60 dark:text-violet-400',
            className,
          )}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />}
          <span className={ENTITY_HEADER_LABEL}>{label}</span>
        </button>
      </Tip>
      {chooserDialog}
    </>
  );
}
