'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Bot, ListTree } from 'lucide-react';
import { tasksApi } from '@/lib/api/tasks';
import { apiErrorText, apiErrorCode, apiErrorDetails } from '@/lib/api/client';

/** A genuinely-running workstream disclosed by the server, with the other live
 * tasks it is also working (the collateral of a Stop). */
export interface GuardWorkstream {
  executionId: string;
  label: string | null;
  otherTasks: { id: string; title: string; status: string }[];
}

/** An open child of a parent whose complete/archive the server bounced. */
export interface GuardChild {
  id: string;
  title: string;
  status: string;
}

export type RuntimeChoice = 'keep_running' | 'stop_running_agent';

/** A lifecycle command that may need one or BOTH confirmations (open children,
 * then a running workstream) before it can apply. */
export interface GuardCommand {
  taskId: string;
  command: 'complete' | 'archive' | 'return_to_todo';
}

const VERB: Record<GuardCommand['command'], { verb: string; done: string }> = {
  complete: { verb: 'complete', done: 'completed the task' },
  archive: { verb: 'archive', done: 'archived the task' },
  return_to_todo: { verb: 'return to Todo', done: 'returned the task to Todo' },
};

interface GuardContextValue {
  /** Issue a guarded lifecycle command, resolving any confirmations it needs.
   * Open children and a running workstream COMPOSE: it collects each
   * acknowledgement in turn and re-issues with all of them, so a parent that has
   * both can still be completed/archived. */
  resolve: (cmd: GuardCommand) => Promise<void>;
}

const GuardContext = createContext<GuardContextValue>({ resolve: async () => {} });

export function useLifecycleGuard(): GuardContextValue {
  return useContext(GuardContext);
}

interface ChildAsk {
  openChildren: GuardChild[];
  command: GuardCommand['command'];
  resolve: (ok: boolean) => void;
}
interface WorkstreamAsk {
  running: GuardWorkstream[];
  command: GuardCommand['command'];
  resolve: (choice: RuntimeChoice | null) => void;
}

/**
 * Provides the confirmation modals for guarded lifecycle changes. A single
 * `resolve` loop issues the command and, on each server bounce, shows the right
 * modal (open-children confirmation, or the running-workstream keep/stop
 * choice), collects the acknowledgement, and re-issues with everything gathered
 * so far. So a parent that has BOTH open children AND a running workstream is
 * confirmed in two steps and then applied with both acknowledgements.
 */
export function LifecycleGuardProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [childAsk, setChildAsk] = useState<ChildAsk | null>(null);
  const [wsAsk, setWsAsk] = useState<WorkstreamAsk | null>(null);

  const askChildren = useCallback(
    (openChildren: GuardChild[], command: GuardCommand['command']) =>
      new Promise<boolean>((res) => setChildAsk({ openChildren, command, resolve: (ok) => { setChildAsk(null); res(ok); } })),
    [],
  );
  const askWorkstream = useCallback(
    (running: GuardWorkstream[], command: GuardCommand['command']) =>
      new Promise<RuntimeChoice | null>((res) => setWsAsk({ running, command, resolve: (c) => { setWsAsk(null); res(c); } })),
    [],
  );

  const resolve = useCallback(
    async (cmd: GuardCommand) => {
      const acks: { acknowledgedChildIds?: string[]; runtimeChoice?: RuntimeChoice; acknowledgedExecutionIds?: string[] } = {};
      // At most: children confirm, then workstream choice, then success.
      for (let attempt = 0; attempt < 4; attempt++) {
        const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
        try {
          if (cmd.command === 'complete') {
            await tasksApi.complete(cmd.taskId, { ...acks, idempotencyKey: key });
          } else {
            await tasksApi.transition(cmd.taskId, cmd.command, { ...acks, idempotencyKey: key });
          }
          qc.invalidateQueries({ queryKey: ['tasks'] });
          qc.invalidateQueries({ queryKey: ['sessions'] });
          qc.invalidateQueries({ queryKey: ['executions'] });
          toast.success(
            acks.runtimeChoice === 'stop_running_agent'
              ? `Stopped the agent and ${VERB[cmd.command].done}`
              : acks.runtimeChoice === 'keep_running'
                ? `Kept the workstream running and ${VERB[cmd.command].done}`
                : `${VERB[cmd.command].done[0].toUpperCase()}${VERB[cmd.command].done.slice(1)}`,
          );
          return;
        } catch (e) {
          const code = apiErrorCode(e);
          const details = apiErrorDetails<{ requiresChildAck?: boolean; openChildren?: GuardChild[]; requiresChoice?: boolean; running?: GuardWorkstream[] }>(e);
          if (code === 'conflict' && details?.requiresChildAck) {
            const ok = await askChildren(details.openChildren ?? [], cmd.command);
            if (!ok) return;
            acks.acknowledgedChildIds = (details.openChildren ?? []).map((c) => c.id);
            continue;
          }
          if (code === 'active_execution' && details?.requiresChoice) {
            const choice = await askWorkstream(details.running ?? [], cmd.command);
            if (!choice) return;
            acks.runtimeChoice = choice;
            acks.acknowledgedExecutionIds = (details.running ?? []).map((w) => w.executionId);
            continue;
          }
          toast.error(apiErrorText(e));
          return;
        }
      }
    },
    [qc, askChildren, askWorkstream],
  );

  return (
    <GuardContext.Provider value={{ resolve }}>
      {children}
      <ChildrenConfirmDialog ask={childAsk} />
      <RunningWorkstreamDialog ask={wsAsk} />
    </GuardContext.Provider>
  );
}

function ChildrenConfirmDialog({ ask }: { ask: ChildAsk | null }) {
  const verb = ask ? VERB[ask.command].verb : 'complete';
  const n = ask?.openChildren.length ?? 0;
  return (
    <Dialog.Root open={!!ask} onOpenChange={(o) => !o && ask?.resolve(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-xl focus:outline-none">
          <div className="flex items-start gap-3">
            <ListTree className="mt-0.5 flex-shrink-0 text-amber-500" size={18} />
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold text-foreground">
                {verb === 'complete' ? 'Complete this task?' : verb === 'archive' ? 'Archive this task?' : 'Return this task to Todo?'}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                It has {n} open subtask{n > 1 ? 's' : ''}, which will be left unchanged.
              </Dialog.Description>
            </div>
          </div>
          <div className="mt-3 max-h-40 overflow-y-auto rounded border border-border bg-muted/40 p-2">
            <ul className="space-y-0.5">
              {(ask?.openChildren ?? []).map((c) => (
                <li key={c.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ListTree size={10} className="flex-shrink-0" />
                  <span className="truncate">{c.title || 'Untitled'}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => ask?.resolve(false)} className="rounded px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              Cancel
            </button>
            <button
              onClick={() => ask?.resolve(true)}
              className="inline-flex items-center gap-1.5 rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
            >
              {verb === 'complete' ? 'Complete anyway' : verb === 'archive' ? 'Archive anyway' : 'Return anyway'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RunningWorkstreamDialog({ ask }: { ask: WorkstreamAsk | null }) {
  const [busy, setBusy] = useState(false);
  const verb = ask ? VERB[ask.command].verb : 'change';
  const workstreams = ask?.running ?? [];

  const choose = (choice: RuntimeChoice | null) => {
    // The re-issue happens back in the resolve loop; just hand the choice back.
    setBusy(choice === 'stop_running_agent');
    ask?.resolve(choice);
    setBusy(false);
  };

  return (
    <Dialog.Root open={!!ask} onOpenChange={(o) => !o && ask?.resolve(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-xl focus:outline-none">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 flex-shrink-0 text-amber-500" size={18} />
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold text-foreground">An agent is actively working this task</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                You can {verb} it and keep the workstream running, or stop the running agent first. Keeping it running
                changes only this task and tells the agent its scope changed. A turn already in flight cannot be
                partially interrupted, and code or artifacts already produced in a shared worktree are not undone.
              </Dialog.Description>
            </div>
          </div>

          <div className="mt-3 max-h-48 overflow-y-auto rounded border border-border bg-muted/40 p-2">
            <ul className="space-y-1.5">
              {workstreams.map((w) => (
                <li key={w.executionId} className="text-xs">
                  <div className="flex items-center gap-2">
                    <Bot size={12} className="flex-shrink-0 text-violet-500" />
                    <span className="truncate text-foreground">{w.label || 'Agent workstream'}</span>
                  </div>
                  {w.otherTasks.length > 0 && (
                    <div className="mt-1 ml-5 space-y-0.5">
                      <div className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">Stopping also affects</div>
                      {w.otherTasks.map((t) => (
                        <div key={t.id} className="flex items-center gap-1.5 text-muted-foreground">
                          <ListTree size={10} className="flex-shrink-0" />
                          <span className="truncate">{t.title || 'Untitled'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button onClick={() => choose(null)} disabled={busy} className="rounded px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              Cancel
            </button>
            <button
              onClick={() => choose('keep_running')}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
            >
              Keep running and {verb}
            </button>
            <button
              onClick={() => choose('stop_running_agent')}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              Stop agent and {verb}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
