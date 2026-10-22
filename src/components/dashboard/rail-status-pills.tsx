'use client';

import { useState } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useActivityBuckets } from '@/hooks/use-activity-buckets';
import type { ActivityItem } from '@/lib/sessions/activity-buckets';
import { openBoard } from '@/lib/client/task-board';
import { useRailSessions } from '@/hooks/use-workspaces';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  BUCKET_CONFIG,
  BUCKET_ORDER,
  type BucketId,
} from '@/components/workspaces/bucket-config';
import { cn } from '@/lib/utils';
import type { RailSession } from '@/lib/api/sessions';
import { executionView } from '@/lib/client/active-view';
import { AgentAttentionRow } from '@/components/workspaces/agent-attention-row';
import { AgentIcon } from '@/components/agents/agent-icon';
import { Tip } from '@/components/ui/tip';
import Link from 'next/link';
import { ClipboardCheck, ShieldAlert, Maximize2 } from 'lucide-react';
import type { RailResponse } from '@/lib/api/sessions';

// The HUD's compact status overview stays visible regardless of rail collapse.
// Its popovers and Agent Activity share the same rows. A row opens the chat,
// and Board expands that bucket. Empty pills stay dimmed in stable positions.

export function RailStatusPills() {
  const { data } = useRailSessions();
  // Inactive work and settled imports are left out (`bucketSessions`), the
  // same reading the collapsed rail's Agents badge counts.
  const buckets = useActivityBuckets();

  return (
    <div className="flex items-center gap-1">
      {BUCKET_ORDER.map((bucketId) => (
        <StatusPill
          key={bucketId}
          bucketId={bucketId}
          items={buckets[bucketId]}
        />
      ))}
      <ReviewAttentionPill reviews={data?.resultReviewAttention ?? []} pendingSessionIds={data?.pendingSessionIds ?? []} />
    </div>
  );
}

export function ReviewAttentionPill({ reviews, pendingSessionIds }: { reviews: NonNullable<RailResponse['resultReviewAttention']>; pendingSessionIds: string[] }) {
  const [open, setOpen] = useState(false);
  if (!reviews.length) return null;
  const needsAttention = reviews.some((review) => review.status === 'failed' || pendingSessionIds.includes(review.sessionId));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Tip label="AI review activity"><button aria-label={`AI reviews: ${reviews.length}${needsAttention ? ', attention needed' : ''}`} className={cn('flex h-[18px] items-center gap-1 rounded px-1.5 text-[10px]', needsAttention ? 'bg-amber-500/15 text-amber-500' : 'bg-muted text-muted-foreground')}>
          {needsAttention ? <ShieldAlert size={10} /> : <ClipboardCheck size={10} />}<span className="font-mono font-semibold">{reviews.length}</span>
        </button></Tip>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <p className="px-1 pb-2 text-xs font-medium">AI review activity</p>
        <div className="max-h-72 overflow-y-auto space-y-1">
          {reviews.map((review) => <Link key={review.reviewId} href={`/results/${review.resultId}`} onClick={() => setOpen(false)} className="block rounded-md px-2 py-2 hover:bg-muted">
            <p className="truncate text-xs font-medium">{review.label ?? 'AI review'}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{pendingSessionIds.includes(review.sessionId) ? 'Needs your response' : review.statusReason ? review.statusReason.replaceAll('_', ' ') : review.status === 'running' ? 'Reviewing with AI' : review.status === 'queued' ? 'Queued' : 'Review failed'}</p>
          </Link>)}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface StatusPillProps {
  bucketId: BucketId;
  items: ActivityItem[];
}

function StatusPill({ bucketId, items }: StatusPillProps) {
  const [open, setOpen] = useState(false);
  const cfg = BUCKET_CONFIG[bucketId];
  const count = items.length;
  const empty = count === 0;

  // Empty pill: dim, non-interactive, no popover. Stable position lets
  // the eye learn the layout so the strip reads as ambient.
  if (empty) {
    return (
      <span
        aria-label={`${cfg.label}: 0`}
        className="flex items-center gap-1 px-1.5 h-[18px] rounded text-[10px] opacity-30 select-none"
      >
        <span className="flex items-center justify-center [&_svg]:size-[10px]">
          {cfg.icon}
        </span>
        <span className="font-mono font-semibold tabular-nums text-muted-foreground">0</span>
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Tip label={cfg.label}>
          <button
            aria-label={`${cfg.label}: ${count}`}
            className={cn(
              'flex items-center gap-1 px-1.5 h-[18px] rounded text-[10px] transition-[filter]',
              'hover:brightness-110 dark:hover:brightness-125',
              'data-[state=open]:brightness-110 dark:data-[state=open]:brightness-125',
              cfg.countBgClass,
            )}
          >
            <span className="flex items-center justify-center [&_svg]:size-[10px]">
              {cfg.icon}
            </span>
            <span className="font-mono font-semibold tabular-nums">{count}</span>
          </button>
        </Tip>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-72 p-0 overflow-hidden"
      >
        <div className={cn(
          'flex items-center gap-1.5 px-3 py-2 border-b border-border/40',
          cfg.headerBgClass,
        )}>
          <span className="flex items-center justify-center">{cfg.icon}</span>
          <span className={cn(
            'flex-1 text-[10.5px] font-bold uppercase tracking-[0.12em]',
            cfg.accentClass,
          )}>
            {cfg.label}
          </span>
          <span className={cn(
            'inline-flex items-center justify-center min-w-[18px] h-[16px] px-1.5 rounded-full text-[9.5px] font-bold font-mono tabular-nums',
            cfg.countBgClass,
          )}>
            {count}
          </span>
          <Tip label={`Show ${cfg.label} in Agent Activity`}>
            <button type="button" aria-label={`Expand ${cfg.label} in Board`}
              className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => {
                setOpen(false);
                // Let the popover restore focus before the Board captures its opener.
                requestAnimationFrame(() => openBoard({ focusBucket: bucketId }));
              }}><Maximize2 className="size-3" />Board</button>
          </Tip>
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {items.map((row) => row.kind === 'agent' ? (
            <AgentAttentionRow key={row.id} item={row.item} variant="pill" onPick={() => setOpen(false)} />
          ) : (
            <PillSessionRow key={row.id} session={row.session} onPick={() => setOpen(false)} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface PillSessionRowProps {
  session: RailSession;
  onPick: () => void;
}

function PillSessionRow({ session, onPick }: PillSessionRowProps) {
  const { activeSessionId, setActiveView } = useDashboard();
  const isActive = activeSessionId === session.id;
  // Rail rows are one-per-execution, so title by the stable execution label
  // (survives "new chat"); fall back to the chat label for legacy/orphaned rows.
  const label = session.execution?.label ?? session.label ?? 'Untitled';
  const labelIsPlaceholder = !(session.execution?.label ?? session.label);
  const wsName = session.workspaceName ?? 'No agent';

  const handleOpen = () => {
    setActiveView(executionView(session.id));
    onPick();
  };

  return (
    <button
      type="button"
      onClick={handleOpen}
      className={cn(
        'w-full flex items-start gap-1.5 px-2.5 py-1.5 text-left rounded-md transition-colors',
        isActive ? 'bg-secondary' : 'hover:bg-muted/50',
      )}
    >
      <AgentIcon workspace={{ name: wsName, attachments: session.workspaceAttachments, emoji: session.workspaceEmoji, areaId: session.workspaceAreaId }} size="sm" />
      <div className="flex-1 min-w-0 leading-tight">
        <div className={cn(
          'text-[11.5px] truncate',
          labelIsPlaceholder ? 'italic text-muted-foreground/70' : 'font-medium text-foreground/90',
        )}>
          {label}
        </div>
        <div className="text-[10px] truncate mt-0.5 text-muted-foreground/70">
          {wsName}
        </div>
      </div>
    </button>
  );
}
