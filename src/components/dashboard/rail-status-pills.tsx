'use client';

import { useMemo, useState } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useRailSessions } from '@/hooks/use-workspaces';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  BUCKET_CONFIG,
  BUCKET_ORDER,
  classifySession,
  type BucketId,
} from '@/components/workspaces/bucket-config';
import { sortSessionsHotnessDesc } from '@/lib/utils/session-sort';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { cn } from '@/lib/utils';
import type { RailSession } from '@/lib/api/sessions';

// Top-HUD status pills. Same buckets as the rail body, just rendered as
// a compact dot+count strip that stays visible regardless of rail
// collapse state or current view. Click → popover of sessions; click a
// row → jumps to that execution. Zero-count pills render dimmed so the
// strip's positions are stable and the eye learns where to look.

export function RailStatusPills() {
  const { data } = useRailSessions();
  const { streamingSessionIds, pendingInputSessionIds } = useDashboard();

  const buckets = useMemo(() => {
    const map: Record<BucketId, RailSession[]> = {
      needsApproval: [],
      unread: [],
      waiting: [],
      working: [],
    };
    for (const s of data?.sessions ?? []) {
      if (s.status !== 'active') continue;
      const id = classifySession(s, pendingInputSessionIds, streamingSessionIds);
      map[id].push(s);
    }
    for (const key of Object.keys(map) as BucketId[]) {
      map[key] = sortSessionsHotnessDesc(map[key]);
    }
    return map;
  }, [data?.sessions, pendingInputSessionIds, streamingSessionIds]);

  return (
    <div className="flex items-center gap-1">
      {BUCKET_ORDER.map((bucketId) => (
        <StatusPill key={bucketId} bucketId={bucketId} sessions={buckets[bucketId]} />
      ))}
    </div>
  );
}

interface StatusPillProps {
  bucketId: BucketId;
  sessions: RailSession[];
}

function StatusPill({ bucketId, sessions }: StatusPillProps) {
  const [open, setOpen] = useState(false);
  const cfg = BUCKET_CONFIG[bucketId];
  const count = sessions.length;
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
        <button
          aria-label={`${cfg.label}: ${count}`}
          title={cfg.label}
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
  const { activeView, setActiveView } = useDashboard();
  const isActive = activeView === session.id;
  const label = session.label ?? 'Untitled';
  const labelIsPlaceholder = !session.label;
  const wsName = session.workspaceName ?? 'No workspace';
  const wsImage = coverAttachmentUrl(session.workspaceAttachments);
  const wsEmoji = session.workspaceEmoji;

  const handleOpen = () => {
    setActiveView(session.id);
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
      <PillWorkspaceAvatar wsImage={wsImage} wsEmoji={wsEmoji} wsName={wsName} />
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

function initialsFor(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return '·';
  const words = cleaned.split(/\s+/);
  if (words.length === 1) return words[0]!.charAt(0).toUpperCase();
  return (words[0]!.charAt(0) + words[1]!.charAt(0)).toUpperCase();
}

function PillWorkspaceAvatar({
  wsImage,
  wsEmoji,
  wsName,
}: {
  wsImage: string | null;
  wsEmoji: string | null;
  wsName: string;
}) {
  return (
    <span className="relative w-5 h-5 flex items-center justify-center flex-shrink-0 mt-px">
      {wsImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={wsImage} alt="" className="w-5 h-5 rounded object-cover" />
      ) : wsEmoji ? (
        <span className="text-base leading-none">{wsEmoji}</span>
      ) : (
        <span
          aria-hidden
          className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold tracking-wide bg-muted text-muted-foreground"
        >
          {initialsFor(wsName)}
        </span>
      )}
    </span>
  );
}
