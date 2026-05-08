'use client';

import { ChevronRight, Folder, Settings, Plus, GitFork } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDashboard } from '@/contexts/dashboard-context';
import { useUpdateWorkspace, useWorkspaceSessions } from '@/hooks/use-workspaces';
import { useAreas } from '@/hooks/use-areas';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { cn } from '@/lib/utils';
import type { WorkspaceWithCounts } from '@/db/types';
import { SessionRow } from './session-row';

interface WorkspaceRowProps {
  workspace: WorkspaceWithCounts;
  onOpenSettings: (id: string) => void;
  onCreateExecution: (id: string) => void;
  onOpenCreateFrom: (id: string) => void;
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
  onOpenCreateFrom,
}: WorkspaceRowProps) {
  const { streamingSessionIds } = useDashboard();
  const updateWs = useUpdateWorkspace();
  const expanded = !workspace.collapsed;
  const { data: sessions } = useWorkspaceSessions(expanded ? workspace.id : null);
  const { data: areas } = useAreas();

  // Icon resolution: workspace own > linked area > default folder.
  const wsImage = coverAttachmentUrl(workspace.attachments);
  const linkedArea = workspace.area_id
    ? areas?.find((a) => a.id === workspace.area_id)
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

  // Streaming wins over needs-review for the badge.
  const childSessions = sessions ?? [];
  const streamingCount = childSessions.filter((s) => streamingSessionIds.has(s.id)).length;
  const reviewCount = Math.max(
    workspace.needs_review_candidate_count - streamingCount,
    0,
  );

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
        <div className="flex items-center gap-0.5">
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onOpenSettings(workspace.id);
            }}
            className="p-1 text-muted-foreground/40 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Workspace settings"
            title="Workspace settings"
          >
            <Settings size={13} />
          </button>
          <WorkspaceBadge streamingCount={streamingCount} reviewCount={reviewCount} />
          {workspace.is_git && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onOpenCreateFrom(workspace.id);
              }}
              className="p-1 text-muted-foreground/40 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Create from PR, branch, or issue"
              title="Create from PR, branch, or issue"
            >
              <GitFork size={13} />
            </button>
          )}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onCreateExecution(workspace.id);
            }}
            className="p-1 text-muted-foreground/40 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="New execution"
            title="New execution"
          >
            <Plus size={13} />
          </button>
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
            childSessions.map((s) => <SessionRow key={s.id} session={s} />)
          )}
        </div>
      )}
    </div>
  );
}

function WorkspaceBadge({ streamingCount, reviewCount }: { streamingCount: number; reviewCount: number }) {
  if (streamingCount > 0) {
    return (
      <span className="flex items-center gap-1 text-[9px] flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-emerald-500/90 font-medium">working</span>
      </span>
    );
  }
  if (reviewCount > 0) {
    return (
      <span className="flex items-center gap-1 text-[9px] flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        <span className="text-amber-500/90 font-medium">{reviewCount} rev</span>
      </span>
    );
  }
  return null;
}
