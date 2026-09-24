'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Loader2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAgentExecutions, useAgentPreviews } from '@/hooks/use-agent';
import { previewApi } from '@/lib/api/preview';
import { PreviewPane } from '@/components/executions/preview/preview-pane';
import type { WorkspaceRecord } from '@/db/types';

/**
 * The agent's previews (docs/agents-view-spec.md Phase 7). A preview belongs
 * to an execution, because that is where an agent's code runs (a preview of
 * the checkout itself is a live-mode execution). So this is the execution
 * view's preview pane with an execution picker in front of it, landing on
 * one that is running.
 */
export function AgentPreview({
  workspace,
  active,
  onOpenSetup,
}: {
  workspace: WorkspaceRecord;
  active: boolean;
  onOpenSetup: () => void;
}) {
  const { all } = useAgentExecutions(workspace.id);
  const { data } = useAgentPreviews(workspace.id, active);
  const previews = useMemo(() => data?.previews ?? [], [data?.previews]);
  const qc = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);

  // The user's pick while it is still one of the agent's executions, else a
  // running preview, else any preview, else the most recent execution.
  const executionIds = useMemo(
    () => new Set(all.map((s) => s.executionId).filter((id): id is string => !!id)),
    [all],
  );
  const selected =
    (picked && executionIds.has(picked) ? picked : null) ??
    previews.find((p) => p.serverStatus === 'running')?.executionId ??
    previews[0]?.executionId ??
    all.find((s) => s.executionId)?.executionId ??
    null;

  const restore = useMutation({
    mutationFn: () => previewApi.restoreSet(workspace.id),
    onSuccess: ({ results }) => {
      const failed = results.filter((r) => !r.ok);
      if (results.length === 0) toast('No pinned previews to bring up');
      else if (failed.length === 0) toast.success(`${results.length} pinned preview${results.length === 1 ? '' : 's'} up`);
      else toast.error(`${failed.length} of ${results.length} pinned previews did not start`);
      void qc.invalidateQueries({ queryKey: ['agent', workspace.id, 'previews'] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Restore failed'),
  });

  if (all.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-center px-8">
        <div className="max-w-xs">
          <p className="text-[13px] font-semibold text-foreground">No previews yet</p>
          <p className="text-[11px] text-muted-foreground/80 mt-1">
            A preview runs the agent&apos;s start command for one execution. Start an execution, then preview it here.
          </p>
        </div>
      </div>
    );
  }

  const hasPinned = previews.some((p) => p.pinned);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="shrink-0 flex items-center gap-2 border-b border-border px-3 py-1.5">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Execution to preview</span>
          <select
            value={selected ?? ''}
            onChange={(e) => setPicked(e.target.value || null)}
            className="w-full appearance-none rounded-md border border-border bg-background py-1 pl-2 pr-7 text-[11.5px] focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {all
              .filter((s) => s.executionId)
              .map((s) => {
                const preview = previews.find((p) => p.executionId === s.executionId);
                const status = preview?.serverStatus === 'running' ? ' (running)' : '';
                return (
                  <option key={s.executionId} value={s.executionId!}>
                    {(s.execution?.label ?? s.label ?? 'Untitled') + status}
                  </option>
                );
              })}
          </select>
          <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </label>
        {hasPinned && (
          <button
            onClick={() => restore.mutate()}
            disabled={restore.isPending}
            className="flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-50"
            title="Bring up every pinned preview in this agent"
          >
            {restore.isPending ? <Loader2 size={11} className="animate-spin" /> : <RotateCw size={11} />}
            Restore pinned
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        {selected ? (
          <PreviewPane
            key={selected}
            executionId={selected}
            workspaceId={workspace.id}
            active={active}
            onOpenWorkspaceSettings={onOpenSetup}
          />
        ) : null}
      </div>
    </div>
  );
}
