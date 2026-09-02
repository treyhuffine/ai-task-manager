'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Bot } from 'lucide-react';
import { tasksApi } from '@/lib/api/tasks';
import { apiErrorText } from '@/lib/api/client';

export interface GuardRequest {
  taskId: string;
  command: 'archive' | 'complete';
}

interface GuardContextValue {
  /** Open the active-agent warning for a task whose archive/complete was
   * rejected because a live agent owns it. */
  open: (req: GuardRequest) => void;
}

const GuardContext = createContext<GuardContextValue>({ open: () => {} });

export function useLifecycleGuard(): GuardContextValue {
  return useContext(GuardContext);
}

/**
 * Provides the active-agent warning modal. When archiving or completing a task
 * with a live owning execution is rejected (`active_execution`), the lifecycle
 * hooks call `open()` instead of showing a toast. The modal names the running
 * work and offers one coordinated action ("Stop agent and change status") or
 * Cancel — a task's agent can never be displaced silently.
 */
export function LifecycleGuardProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<GuardRequest | null>(null);
  const open = useCallback((r: GuardRequest) => setReq(r), []);
  return (
    <GuardContext.Provider value={{ open }}>
      {children}
      <ActiveAgentDialog req={req} onClose={() => setReq(null)} />
    </GuardContext.Provider>
  );
}

function ActiveAgentDialog({ req, onClose }: { req: GuardRequest | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: execs, isLoading } = useQuery({
    queryKey: ['tasks', req?.taskId, 'executions'],
    queryFn: () => tasksApi.executions(req!.taskId),
    enabled: !!req,
  });

  const verb = req?.command === 'complete' ? 'complete' : 'archive';
  const count = execs?.length ?? 0;

  const proceed = async () => {
    if (!req) return;
    setBusy(true);
    try {
      const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
      if (req.command === 'complete') {
        await tasksApi.complete(req.taskId, { stopOwningExecutions: true, idempotencyKey: key });
      } else {
        await tasksApi.transition(req.taskId, 'archive', { stopOwningExecutions: true, idempotencyKey: key });
      }
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success(req.command === 'complete' ? 'Stopped the agent and completed the task' : 'Stopped the agent and archived the task');
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
            <AlertTriangle className="mt-0.5 flex-shrink-0 text-amber-500" size={18} />
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold text-foreground">An agent is working on this task</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                To {verb} it now, {count > 1 ? 'those agents' : 'that agent'} will be stopped. Their work so far is kept in the execution history.
              </Dialog.Description>
            </div>
          </div>

          <div className="mt-3 max-h-40 overflow-y-auto rounded border border-border bg-muted/40 p-2">
            {isLoading ? (
              <Loader2 className="animate-spin text-muted-foreground" size={14} />
            ) : count === 0 ? (
              <p className="text-xs text-muted-foreground">No live executions found. They may have just finished.</p>
            ) : (
              <ul className="space-y-1">
                {(execs ?? []).map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-xs">
                    <Bot size={12} className="flex-shrink-0 text-violet-500" />
                    <span className="truncate text-foreground">{e.label || 'Agent execution'}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">{e.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onClose} disabled={busy} className="rounded px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              Cancel
            </button>
            <button
              onClick={proceed}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              Stop agent{count > 1 ? 's' : ''} and {verb}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
