'use client';

import { useEffect, useRef } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useActivityBuckets } from '@/hooks/use-activity-buckets';
import { useRailSessions, useWorkspaces } from '@/hooks/use-workspaces';
import { useBoardColumns, revealedColumns } from '@/hooks/use-board-columns';
import { BUCKET_ORDER, BUCKET_CONFIG, type BucketId } from '@/components/workspaces/bucket-config';
import { AgentIcon } from '@/components/agents/agent-icon';
import { activityDestination, type ActivityItem } from '@/lib/sessions/activity-buckets';
import { clearBoardFocus, closeTaskBoard } from '@/lib/client/task-board';
import { latestActivityAt } from '@/lib/utils/session-sort';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { agentVoice } from '@/lib/utils/agent-rail';
import { cn } from '@/lib/utils';
import { ColumnPicker, HiddenColumnsEmpty } from './column-picker';
import { ListToolbar } from '@/components/shared/list-toolbar';

const COLUMN_OPTIONS = BUCKET_ORDER.map((id) => ({ id, label: BUCKET_CONFIG[id].label }));

export function AgentActivityBoard({ focusBucket }: { focusBucket: BucketId | null }) {
  const buckets = useActivityBuckets();
  const rail = useRailSessions();
  const agents = useWorkspaces({ status: 'active' });
  const { visible, setVisible } = useBoardColumns('ri.board.columns.activity', BUCKET_ORDER, BUCKET_ORDER);
  const columns = revealedColumns(BUCKET_ORDER, visible, focusBucket);
  const targetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!focusBucket) return;
    const frame = requestAnimationFrame(() => {
      targetRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
      targetRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusBucket]);

  const loading = rail.isPending || agents.isPending;
  const error = rail.isError || agents.isError;
  return <div className="flex min-h-0 flex-1 flex-col">
    <ListToolbar className="flex-wrap">
      <p className="mr-auto text-xs text-muted-foreground">Live conversations by attention and activity</p>
      <ColumnPicker columns={COLUMN_OPTIONS} visible={columns} onChange={(next) => {
        // A deliberate picker change adopts the currently displayed selection.
        setVisible(next);
        clearBoardFocus();
      }} />
    </ListToolbar>
    {focusBucket && !visible.includes(focusBucket) && <p className="px-4 pt-2 text-xs text-muted-foreground" role="status">
      Showing {BUCKET_CONFIG[focusBucket].label} for this visit. Your saved columns are unchanged.
    </p>}
    {error && <div role="alert" className="px-4 py-2 text-xs text-destructive">
      Activity could not be refreshed. <button type="button" className="underline" onClick={() => void Promise.all([rail.refetch(), agents.refetch()])}>Try again</button>
    </div>}
    <div className="min-h-0 flex-1 overflow-x-auto p-3">
      <div className="flex h-full gap-3">
        {columns.length === 0 && <HiddenColumnsEmpty onShowAll={() => setVisible([...BUCKET_ORDER])} />}
        {columns.map((id) => {
          const cfg = BUCKET_CONFIG[id];
          return <section key={id} aria-label={cfg.label} tabIndex={-1}
            ref={id === focusBucket ? targetRef : undefined}
            className={cn('flex min-h-0 min-w-[280px] flex-1 flex-col rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring', id === focusBucket && 'ring-1 ring-primary/50')}>
            <div className={cn('mb-2 flex items-center gap-2 px-2 py-1', cfg.accentClass)}>
              {cfg.icon}<h2 className="flex-1 text-xs font-semibold">{cfg.label}</h2>
              <span className="text-xs tabular-nums text-muted-foreground">{loading ? '' : buckets[id].length}</span>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg bg-muted/40 p-2 [scrollbar-width:thin]">
              {loading && !buckets[id].length ? <div aria-busy="true" aria-label={`Loading ${cfg.label}`} className="h-28 animate-pulse rounded-lg bg-muted" /> : null}
              {!loading && !error && !buckets[id].length && <p className="px-3 py-8 text-center text-xs text-muted-foreground">No conversations here</p>}
              {buckets[id].map((row) => <ActivityCard key={row.id} row={row} bucket={id} />)}
            </div>
          </section>;
        })}
      </div>
    </div>
  </div>;
}

function ActivityCard({ row, bucket }: { row: ActivityItem; bucket: BucketId }) {
  const { openExecution, openAgent } = useDashboard();
  const main = row.kind === 'agent' ? row.item : null;
  const session = row.kind === 'execution' ? row.session : null;
  const name = main?.workspace.name ?? session?.workspaceName ?? 'No agent';
  const identity = main?.workspace ?? {
    name, attachments: session?.workspaceAttachments ?? [], emoji: session?.workspaceEmoji ?? null, areaId: session?.workspaceAreaId ?? null,
  };
  const title = main ? `${name}'s main chat` : session?.execution?.label ?? session?.label ?? 'Untitled chat';
  const context = main ? agentVoice({ activity: main.activity, waitingOn: main.chat.waitingOn, preview: main.chat.preview, purpose: main.workspace.purpose }).text
    : session?.waitingOn ?? (session?.label !== title ? session?.label : null);
  const at = main ? latestActivityAt(main.chat) : session?.lastActivityAt ?? session?.startedAt;
  const destination = activityDestination(row);
  return <button type="button" onClick={() => {
    closeTaskBoard();
    if (destination.kind === 'agent') openAgent(destination.id);
    else openExecution(destination.id);
  }} className="w-full rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <span className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><AgentIcon workspace={identity} size="sm" /><span className="truncate">{name}</span></span>
    <span className="line-clamp-3 block text-sm font-medium">{title}</span>
    {context && <span className="mt-2 block line-clamp-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{context}</span>}
    <span className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
      <span className={BUCKET_CONFIG[bucket].accentClass}>{BUCKET_CONFIG[bucket].label}</span>
      {at && <span>{formatCompactRelative(at)}</span>}
    </span>
  </button>;
}
