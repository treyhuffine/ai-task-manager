'use client';

import { useDashboard } from '@/contexts/dashboard-context';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { cn } from '@/lib/utils';
import { isSessionUnread } from '@/lib/utils/session-sort';
import type { RailSession } from '@/lib/api/sessions';
import { useSessionRowHover } from './session-hover-context';

interface SkinnySessionRowProps {
  session: RailSession;
}

/**
 * Icon-only session affordance for the skinny rail. The whole row is
 * the workspace identity glyph (image / emoji / initial) with a small
 * status pip overlay in the corner — "which workspace and is it hot"
 * at a glance, the rest comes from the hover preview panel.
 *
 * Click opens the execution. Hover triggers the same preview the wide
 * rows do via `useSessionRowHover`.
 */
export function SkinnySessionRow({ session }: SkinnySessionRowProps) {
  const { activeView, setActiveView, streamingSessionIds, pendingInputSessionIds } = useDashboard();
  const { rowRef, onMouseEnter, onMouseLeave, closeNow } = useSessionRowHover(session.id);

  const isActive = activeView === session.id;
  const isStreaming = streamingSessionIds.has(session.id);
  const isPending = pendingInputSessionIds.has(session.id);

  // Shared unread rule so the pip stays consistent with SessionRow/StatusView;
  // the streaming overlay stays local.
  const isUnread = !isStreaming && isSessionUnread(session);

  const handleOpen = () => {
    closeNow();
    setActiveView(session.id);
  };

  const wsImage = coverAttachmentUrl(session.workspaceAttachments);
  const wsEmoji = session.workspaceEmoji;
  const wsName = session.workspaceName ?? 'No workspace';

  return (
    <div
      ref={rowRef}
      onClick={handleOpen}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
      title={`${session.execution?.label ?? session.label ?? 'Untitled'} · ${wsName}`}
      className={cn(
        'group relative flex items-center justify-center w-7 h-7 mx-auto rounded-md cursor-pointer transition-colors',
        isActive ? 'ring-2 ring-foreground/80' : 'hover:ring-1 hover:ring-foreground/30',
      )}
    >
      {wsImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={wsImage} alt="" className="w-7 h-7 rounded-md object-cover" />
      ) : wsEmoji ? (
        <span className="w-7 h-7 rounded-md flex items-center justify-center text-base leading-none">
          {wsEmoji}
        </span>
      ) : (
        <span
          aria-hidden
          className="w-7 h-7 rounded-md flex items-center justify-center text-foreground/80 text-[13px] font-bold tracking-wide"
        >
          {initialsFor(wsName)}
        </span>
      )}
      <StatusOverlay
        isStreaming={isStreaming}
        isPending={isPending}
        isUnread={isUnread}
      />
    </div>
  );
}

function initialsFor(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return '·';
  const words = cleaned.split(/\s+/);
  if (words.length === 1) return words[0]!.charAt(0).toUpperCase();
  return (words[0]!.charAt(0) + words[1]!.charAt(0)).toUpperCase();
}

/**
 * Tiny status dot in the bottom-right of the glyph. Ring-2 in the
 * background color so the dot reads as floating above the icon
 * regardless of whether the underlying glyph is light or dark.
 *
 * Visible only when the session is non-idle — idle sessions show no
 * overlay so the rail's color noise correlates with actual activity.
 */
function StatusOverlay({
  isStreaming,
  isPending,
  isUnread,
}: {
  isStreaming: boolean;
  isPending: boolean;
  isUnread: boolean;
}) {
  if (!isStreaming && !isPending && !isUnread) return null;
  const cls = isStreaming
    ? 'bg-emerald-500 animate-pulse'
    : isPending
      ? 'bg-amber-500'
      : 'bg-amber-500';
  return (
    <span
      aria-hidden
      className={cn(
        'absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-background',
        cls,
      )}
    />
  );
}
