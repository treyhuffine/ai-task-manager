'use client';

import { useState } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useSessionBuckets } from '@/hooks/use-session-buckets';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  BUCKET_CONFIG,
  BUCKET_ORDER,
  type BucketId,
} from '@/components/workspaces/bucket-config';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { cn } from '@/lib/utils';
import type { RailSession } from '@/lib/api/sessions';
import { executionView } from '@/lib/client/active-view';
import { useAgentAttention, type AgentAttentionItem } from '@/hooks/use-agent-attention';
import { AgentAttentionRow } from '@/components/workspaces/agent-attention-row';
import { WorkspaceAvatar } from '@/components/workspaces/history-row';
import { Tip } from '@/components/ui/tip';

// Top-HUD status pills: every active execution by status, as a compact
// dot+count strip that stays visible regardless of rail collapse state or
// current view. This is the app's one by-status view (the rail lists work by
// agent and by time). Click → popover of sessions; click a row → jumps to that
// execution. Zero-count pills render dimmed so the strip's positions are
// stable and the eye learns where to look.

export function RailStatusPills() {
  // Inactive work and settled imports are left out (`bucketSessions`), the
  // same reading the collapsed rail's Agents badge counts.
  const buckets = useSessionBuckets();
  // Agents that want you count where their work counts, so "needs you"
  // anywhere in the app is one number. Thinking stays out of Working.
  const agents = useAgentAttention();

  return (
    <div className="flex items-center gap-1">
      {BUCKET_ORDER.map((bucketId) => (
        <StatusPill
          key={bucketId}
          bucketId={bucketId}
          sessions={buckets[bucketId]}
          agents={agents.filter((a) => a.bucket === bucketId)}
        />
      ))}
    </div>
  );
}

interface StatusPillProps {
  bucketId: BucketId;
  sessions: RailSession[];
  /** Agents in this bucket, listed first. */
  agents: AgentAttentionItem[];
}

function StatusPill({ bucketId, sessions, agents }: StatusPillProps) {
  const [open, setOpen] = useState(false);
  const cfg = BUCKET_CONFIG[bucketId];
  const count = sessions.length + agents.length;
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
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {agents.map((item) => (
            <AgentAttentionRow key={item.workspace.id} item={item} variant="pill" onPick={() => setOpen(false)} />
          ))}
          {sessions.map((s) => (
            <PillSessionRow
              key={s.id}
              session={s}
              onPick={() => setOpen(false)}
            />
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
  const wsImage = coverAttachmentUrl(session.workspaceAttachments);
  const wsEmoji = session.workspaceEmoji;

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
      <WorkspaceAvatar wsImage={wsImage} wsEmoji={wsEmoji} wsName={wsName} />
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
