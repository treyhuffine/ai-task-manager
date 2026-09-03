'use client';

import { useMemo } from 'react';
import { ChevronRight, Folder, Settings, Plus } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDashboard } from '@/contexts/dashboard-context';
import { useUpdateWorkspace, useWorkspaceSessions, useRailSessions } from '@/hooks/use-workspaces';
import { useAreas } from '@/hooks/use-areas';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { sortSessionsHotnessDesc, isSessionUnread } from '@/lib/utils/session-sort';
import { cn } from '@/lib/utils';
import { hot } from '@/lib/_debug/hot-path';
import type { WorkspaceWithCounts } from '@/db/types';
import { SessionRow } from './session-row';

interface WorkspaceRowProps {
  workspace: WorkspaceWithCounts;
  onOpenSettings: (id: string) => void;
  /** Express lane — start immediately on remembered settings (shift-click). */
  onCreateExecution: (id: string) => void;
  /** Open the launcher seeded with this workspace. */
  onOpenLauncher: (id: string) => void;
}

/**
 * One workspace in the left nav. The whole header is the drag handle —
 * dnd-kit's distance-activation constraint means a quick click still
 * fires the collapse toggle, only deliberate drag motion reorders.
 *
 * The icon area swaps on hover: workspace icon (image / emoji / area
 * fallback / folder default) by default; collapse chevron when the
 * pointer is over the row. Cuts visual weight while idle and signals
 * "click here to fold" on hover.
 *
 * Aggregates work off the row's pre-counted candidates plus the runtime
 * streaming map: any child currently piping live stdio outranks "needs
 * review" in the badge, and is subtracted from the review count so we
 * don't double-surface a session.
 */
export function WorkspaceRow({
  workspace,
  onOpenSettings,
  onCreateExecution,
  onOpenLauncher,
}: WorkspaceRowProps) {
  const { streamingSessionIds, pendingInputSessionIds } = useDashboard();
  const updateWs = useUpdateWorkspace();
  const expanded = !workspace.collapsed;
  // Child rows are sourced from the shared rail query below, not a per-workspace
  // `/sessions` fetch. `listRailSessions` is `listWorkspaceExecutions` scoped
  // wider (same joins, same primary-chat dedup, same order), and the rail is
  // already loaded here for the header counts, so filtering it by workspace
  // reproduces the per-workspace list with zero extra requests — instead of one
  // `/workspaces/:id/sessions` call per expanded workspace.
  //
  // Left wired but idle (passed null) rather than removed, so reverting is a
  // two-line change: capture `const { data: sessions } = useWorkspaceSessions(
  // expanded ? workspace.id : null)` here, and source `childSessions` from
  // `sessions` again below.
  useWorkspaceSessions(null);
  const { data: railData } = useRailSessions();
  const { data: areas } = useAreas();

  // Icon resolution: workspace own > linked area > default folder.
  const wsImage = coverAttachmentUrl(workspace.attachments);
  const linkedArea = workspace.areaId
    ? areas?.find((a) => a.id === workspace.areaId)
    : undefined;
  const areaImage = linkedArea ? coverAttachmentUrl(linkedArea.attachments) : null;
  const iconImage = wsImage ?? (workspace.emoji ? null : areaImage);
  const iconEmoji = workspace.emoji ?? (wsImage ? null : linkedArea?.emoji ?? null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workspace.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Re-sort children client-side so the hottest row stays at the top
  // regardless of the API's stored order. Uses the same hotness key as
  // the by-status view so the two surfaces agree on ordering. Rows are the
  // rail's, filtered to this workspace's active sessions (see the note above).
  const childSessions = useMemo(
    () =>
      sortSessionsHotnessDesc(
        (railData?.sessions ?? []).filter(
          (s) => s.workspaceId === workspace.id && s.status === 'active',
        ),
      ),
    [railData?.sessions, workspace.id],
  );

  // Per-state counts for the header dots. Computed off the rail data
  // (cross-workspace, always loaded) so the indicators are accurate
  // whether the workspace is expanded or collapsed. Classification
  // mirrors `StatusView.classify` so a session lives in exactly one
  // bucket and the totals don't double-count.
  const counts = useMemo(() => {
    hot('memo WorkspaceRow.counts');
    let working = 0;
    let needsApproval = 0;
    let unread = 0;
    const rows = railData?.sessions ?? [];
    for (const s of rows) {
      if (s.workspaceId !== workspace.id || s.status !== 'active') continue;
      if (pendingInputSessionIds.has(s.id)) {
        needsApproval++;
        continue;
      }
      if (streamingSessionIds.has(s.id)) {
        working++;
        continue;
      }
      if (isSessionUnread(s)) {
        unread++;
      }
    }
    return { working, needsApproval, unread };
  }, [railData?.sessions, workspace.id, streamingSessionIds, pendingInputSessionIds]);
  // `attention` rolls unread + needs-approval into one amber count — they
  // share the same urgency color across the rail (NeedsReviewSection
  // header, by-status bucket, here), so rendering them as two identical
  // amber pills would just look like a duplicate. The by-status view
  // still separates them into distinct buckets for triage.
  const attentionCount = counts.needsApproval + counts.unread;
  const hasAnyCount = counts.working > 0 || attentionCount > 0;

  const toggleCollapse = () => {
    updateWs.mutate({ id: workspace.id, collapsed: expanded });
  };

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'opacity-60')}>
      {/* Header — whole row is the drag handle (no icon needed).
          Inner action buttons stop pointerdown so clicking + or ⋮ never
          initiates a drag, even on slow clicks. */}
      <div
        {...attributes}
        {...listeners}
        className="group flex items-center gap-1.5 px-1 py-1 rounded-md hover:bg-muted/40 transition-colors cursor-grab active:cursor-grabbing select-none touch-none"
      >
        <button
          onClick={toggleCollapse}
          className="flex-1 flex items-center gap-1 min-w-0"
        >
          {/* Icon swap on hover: emoji/image when idle, chevron-toggle on hover. */}
          <span className="relative w-5 h-5 flex items-center justify-center flex-shrink-0">
            <span className="group-hover:hidden flex items-center justify-center">
              {iconImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={iconImage} alt="" className="w-5 h-5 rounded object-cover" />
              ) : iconEmoji ? (
                <span className="text-base leading-none">{iconEmoji}</span>
              ) : (
                <Folder size={13} className="text-muted-foreground/60" />
              )}
            </span>
            <ChevronRight
              size={13}
              className={cn(
                'hidden group-hover:block text-muted-foreground/80 transition-transform',
                expanded && 'rotate-90',
              )}
            />
          </span>
          <span className="text-[11.5px] font-semibold truncate text-foreground">
            {workspace.name}
          </span>
        </button>
        {/* Action buttons + status dots share the same horizontal slot.
            At rest the dots are visible and the buttons are invisible
            and non-interactive; on row hover the dots fade out and the
            buttons fade in. `pointer-events-none` on the buttons at
            rest keeps clicks under the dots from firing unseen actions. */}
        <div className="relative flex items-center gap-0.5">
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onOpenSettings(workspace.id);
            }}
            className="p-1 text-muted-foreground/40 hover:text-foreground opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity"
            aria-label="Workspace settings"
            title="Workspace settings"
          >
            <Settings size={13} />
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              // Express lane: shift-click skips the modal and starts an
              // execution on this workspace's remembered settings, which
              // is what the bare ➕ used to do on every click.
              if (e.shiftKey) onCreateExecution(workspace.id);
              else onOpenLauncher(workspace.id);
            }}
            className="p-1 text-muted-foreground/40 hover:text-foreground opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity"
            aria-label="Start work"
            title="Start work (shift-click to skip the setup)"
          >
            <Plus size={13} />
          </button>

          {hasAnyCount && (
            <div className="absolute inset-y-0 right-1 flex items-center gap-1 pointer-events-none group-hover:opacity-0 transition-opacity">
              {counts.working > 0 && <CountDot variant="working" count={counts.working} />}
              {attentionCount > 0 && <CountDot variant="attention" count={attentionCount} />}
            </div>
          )}
        </div>
      </div>

      {/* Sessions */}
      {expanded && (
        <div className="space-y-0.5 mt-0.5 mb-1">
          {childSessions.length === 0 ? (
            <div className="pl-5 py-1 text-[10px] italic text-muted-foreground/50">
              No sessions yet
            </div>
          ) : (
            childSessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                workspaceIsGit={workspace.isGit}
                onOpenWorkspaceSettings={onOpenSettings}
                onOpenLauncher={onOpenLauncher}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

type CountVariant = 'working' | 'attention';

const COUNT_VARIANT_CLASSES: Record<CountVariant, string> = {
  working: 'bg-emerald-500/90 text-white',
  attention: 'bg-amber-500/90 text-white',
};

const COUNT_VARIANT_LABELS: Record<CountVariant, string> = {
  working: 'working',
  attention: 'needing attention',
};

/**
 * Tiny count pill rendered in the workspace header's status slot. One
 * pill per active state — working / awaiting approval / unread — with
 * the matching count inside. Hidden under the action buttons on row
 * hover so the buttons can take the slot back without layout shift.
 *
 * Visually consistent with the skinny rail's status overlay so the same
 * colors mean the same thing across both rail modes.
 */
function CountDot({ variant, count }: { variant: CountVariant; count: number }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full',
        'text-[9px] font-bold font-mono tabular-nums leading-none',
        COUNT_VARIANT_CLASSES[variant],
        variant === 'working' && 'animate-pulse',
      )}
      aria-label={`${count} ${COUNT_VARIANT_LABELS[variant]}`}
      title={`${count} ${COUNT_VARIANT_LABELS[variant]}`}
    >
      {count}
    </span>
  );
}
