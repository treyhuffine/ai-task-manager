'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Bot, ListTree } from 'lucide-react';
import { tasksApi } from '@/lib/api/tasks';
import { apiErrorText } from '@/lib/api/client';

/** A genuinely-running workstream disclosed by the server, with the other live
 * tasks it is also working (the collateral of a Stop). */
export interface GuardWorkstream {
  executionId: string;
  label: string | null;
  otherTasks: { id: string; title: string; status: string }[];
}

export interface GuardRequest {
  taskId: string;
  command: 'archive' | 'complete' | 'return_to_todo';
  /** The running workstreams the server reported behind the conflict. */
  running: GuardWorkstream[];
}

/** Per-command copy: the infinitive for the warning/buttons and the past tense
 * for the success toast. */
const GUARD_ACTION: Record<GuardRequest['command'], { verb: string; done: string }> = {
  complete: { verb: 'complete', done: 'completed the task' },
  archive: { verb: 'archive', done: 'archived the task' },
  return_to_todo: { verb: 'return to Todo', done: 'returned the task to Todo' },
};

/** An open child of a parent whose complete/archive the server bounced pending
 * confirmation. */
export interface GuardChild {
  id: string;
  title: string;
  status: string;
}

export interface ChildConfirmRequest {
  taskId: string;
  command: 'archive' | 'complete';
  openChildren: GuardChild[];
}

interface GuardContextValue {
  /** Open the running-workstream warning for a task whose change was returned as
   * a conflict because a genuinely running agent is associated with it. */
  open: (req: GuardRequest) => void;
  /** Open the open-children confirmation for a parent whose complete/archive the
   * server bounced. Confirming re-issues the change with the acknowledged ids;
   * children are left unchanged. */
  openChildrenConfirm: (req: ChildConfirmRequest) => void;
}

const GuardContext = createContext<GuardContextValue>({ open: () => {}, openChildrenConfirm: () => {} });

export function useLifecycleGuard(): GuardContextValue {
  return useContext(GuardContext);
}

/**
 * Provides the running-workstream warning modal. When a task lifecycle change is
 * returned as a conflict because a genuinely running agent is associated with
 * it, the lifecycle hooks call `open()` with the disclosed workstreams instead
 * of showing a toast. The modal offers an explicit, non-silent choice: keep the
 * workstream running (change only the task) or stop the running agent (preserving
 * the execution), and lists every collateral task a Stop would leave underway.
 */
export function LifecycleGuardProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<GuardRequest | null>(null);
  const [childReq, setChildReq] = useState<ChildConfirmRequest | null>(null);
  const open = useCallback((r: GuardRequest) => setReq(r), []);
  const openChildrenConfirm = useCallback((r: ChildConfirmRequest) => setChildReq(r), []);
  return (
    <GuardContext.Provider value={{ open, openChildrenConfirm }}>
      {children}
      <RunningWorkstreamDialog req={req} onClose={() => setReq(null)} />
      <ChildrenConfirmDialog req={childReq} onClose={() => setChildReq(null)} />
    </GuardContext.Provider>
  );
}

function ChildrenConfirmDialog({ req, onClose }: { req: ChildConfirmRequest | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const verb = req?.command === 'complete' ? 'complete' : 'archive';
  const n = req?.openChildren.length ?? 0;

  const confirm = async () => {
    if (!req) return;
    setBusy(true);
    try {
      const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
      const ackIds = req.openChildren.map((c) => c.id);
      if (req.command === 'complete') {
        await tasksApi.complete(req.taskId, { acknowledgedChildIds: ackIds, idempotencyKey: key });
      } else {
        await tasksApi.transition(req.taskId, 'archive', { acknowledgedChildIds: ackIds, idempotencyKey: key });
      }
      qc.invalidateQueries({ queryKey: ['tasks'] });
      toast.success(req.command === 'complete' ? 'Completed the task; subtasks left unchanged' : 'Archived the task; subtasks left unchanged');
      onClose();
    } catch (e) {
      toast.error(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={!!req} onOpenChange={(o) => !o && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-xl focus:outline-none">
          <div className="flex items-start gap-3">
            <ListTree className="mt-0.5 flex-shrink-0 text-amber-500" size={18} />
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold text-foreground">
                {verb === 'complete' ? 'Complete this task?' : 'Archive this task?'}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                It has {n} open subtask{n > 1 ? 's' : ''}, which will be left unchanged.
              </Dialog.Description>
            </div>
          </div>
          <div className="mt-3 max-h-40 overflow-y-auto rounded border border-border bg-muted/40 p-2">
            <ul className="space-y-0.5">
              {(req?.openChildren ?? []).map((c) => (
                <li key={c.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ListTree size={10} className="flex-shrink-0" />
                  <span className="truncate">{c.title || 'Untitled'}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onClose} disabled={busy} className="rounded px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-60"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              {verb === 'complete' ? 'Complete anyway' : 'Archive anyway'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RunningWorkstreamDialog({ req, onClose }: { req: GuardRequest | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const verb = req ? GUARD_ACTION[req.command].verb : 'change';
  const workstreams = req?.running ?? [];
  const collateral = workstreams.flatMap((w) => w.otherTasks);

  const apply = async (choice: 'keep_running' | 'stop_running_agent') => {
    if (!req) return;
    setBusy(true);
    try {
      const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
      // Re-issue with the EXACT execution set the user saw, so the server can
      // reject if the running set changed rather than stop an undisclosed agent.
      const acknowledgedExecutionIds = workstreams.map((w) => w.executionId);
      if (req.command === 'complete') {
        await tasksApi.complete(req.taskId, { runtimeChoice: choice, idempotencyKey: key, acknowledgedExecutionIds });
      } else {
        await tasksApi.transition(req.taskId, req.command, { runtimeChoice: choice, idempotencyKey: key, acknowledgedExecutionIds });
      }
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['executions'] });
      toast.success(
        choice === 'keep_running'
          ? `Kept the workstream running and ${GUARD_ACTION[req.command].done}`
          : `Stopped the agent and ${GUARD_ACTION[req.command].done}`,
      );
      onClose();
    } catch (e) {
      // A stop that failed leaves the task unchanged and says so.
      toast.error(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={!!req} onOpenChange={(o) => !o && !busy && onClose()}>
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
                      <div className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        Stopping also affects
                      </div>
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
            <button onClick={onClose} disabled={busy} className="rounded px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              Cancel
            </button>
            <button
              onClick={() => apply('keep_running')}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              Keep running and {verb}
            </button>
            <button
              onClick={() => apply('stop_running_agent')}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
              title={collateral.length > 0 ? `Also stops work on ${collateral.length} other task${collateral.length > 1 ? 's' : ''}` : undefined}
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
