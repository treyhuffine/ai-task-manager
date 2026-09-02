'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CheckCheck, MessageSquareDashed, EyeOff, Loader2 } from 'lucide-react';
import { api, apiErrorText } from '@/lib/api/client';
import type { ExecutionReviewContext, ReviewDisposition } from '@/db/types';
import { cn } from '@/lib/utils';

const DISPOSITION_LABEL: Record<ReviewDisposition, string> = {
  accepted: 'Accepted',
  changes_requested: 'Changes requested',
  dismissed: 'Dismissed',
};

/**
 * Explicit review-through for an execution's latest output. Reading output only
 * clears unread; this is the disposition tied to the exact output event. New
 * output after the last reviewed output re-opens the obligation. When the
 * execution owns one task, Accept-and-complete is offered.
 */
export function ExecutionReviewBar({ executionId }: { executionId: string }) {
  const qc = useQueryClient();

  const { data: ctx } = useQuery({
    queryKey: ['executions', executionId, 'review-context'],
    queryFn: () => api.get<ExecutionReviewContext>(`/executions/${executionId}/review-context`),
    refetchInterval: 15_000,
    staleTime: 8_000,
  });

  const review = useMutation({
    mutationFn: (input: { disposition: ReviewDisposition; completeTask?: boolean }) =>
      api.post(`/executions/${executionId}/review`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['executions', executionId, 'review-context'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e) => toast.error(apiErrorText(e)),
  });

  // Review-through is for TASK-OWNED executions. Taskless quick work keeps its
  // read/unread behavior (per the spec) and shows no review bar. Also hidden
  // until the agent has produced output to disposition.
  if (!ctx || !ctx.latestOutputEventId || !ctx.owningTaskId) return null;

  const pending = review.isPending;
  const reviewed = ctx.latestDisposition;

  return (
    <div
      className={cn(
        'mx-3 mb-2 flex flex-shrink-0 flex-wrap items-center gap-2 rounded-lg border px-3 py-2',
        ctx.hasUnreviewedOutput
          ? 'border-violet-500/30 bg-violet-500/[0.06]'
          : 'border-border bg-muted/40',
      )}
    >
      <span className="text-[11px] font-medium text-foreground">
        {ctx.hasUnreviewedOutput ? 'Review the agent’s latest output' : `Reviewed: ${reviewed ? DISPOSITION_LABEL[reviewed] : ''}`}
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        {pending && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
        <ReviewButton
          label="Request changes"
          active={reviewed === 'changes_requested'}
          disabled={pending}
          onClick={() => review.mutate({ disposition: 'changes_requested' })}
          icon={<MessageSquareDashed size={12} />}
          tone="amber"
        />
        <ReviewButton
          label="Dismiss"
          active={reviewed === 'dismissed'}
          disabled={pending}
          onClick={() => review.mutate({ disposition: 'dismissed' })}
          icon={<EyeOff size={12} />}
          tone="muted"
        />
        <ReviewButton
          label="Accept"
          active={reviewed === 'accepted'}
          disabled={pending}
          onClick={() => review.mutate({ disposition: 'accepted' })}
          icon={<Check size={12} />}
          tone="emerald"
        />
        {ctx.owningTaskId && (
          <ReviewButton
            label="Accept & complete"
            active={false}
            disabled={pending}
            onClick={() => review.mutate({ disposition: 'accepted', completeTask: true })}
            icon={<CheckCheck size={12} />}
            tone="emerald-solid"
            title={ctx.owningTaskTitle ? `Accept and complete “${ctx.owningTaskTitle}”` : 'Accept and complete the task'}
          />
        )}
      </div>
    </div>
  );
}

function ReviewButton({
  label,
  icon,
  active,
  disabled,
  onClick,
  tone,
  title,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  tone: 'amber' | 'muted' | 'emerald' | 'emerald-solid';
  title?: string;
}) {
  const tones: Record<string, string> = {
    amber: active ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' : 'text-muted-foreground hover:bg-amber-500/10 hover:text-amber-700 dark:hover:text-amber-300',
    muted: active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    emerald: active ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300',
    'emerald-solid': 'bg-emerald-600 text-white hover:bg-emerald-700',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={cn('inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-60', tones[tone])}
    >
      {icon}
      {label}
    </button>
  );
}
