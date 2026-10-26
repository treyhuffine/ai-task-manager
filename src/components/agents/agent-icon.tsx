'use client';

import { useAreas } from '@/hooks/use-areas';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { agentInitials } from '@/lib/client/agent-initials';
import type { AreaRecord, WorkspaceRecord } from '@/db/types';
import { cn } from '@/lib/utils';

const SIZES = {
  // In a line of text (a mention chip): the same box as xs, with the emoji
  // filling it and initials big enough to read.
  inline: { box: 'w-4 h-4', emoji: 'text-[15px]', initials: 'text-[8px]' },
  xs: { box: 'w-4 h-4', emoji: 'text-[12px]', initials: 'text-[7px]' },
  sm: { box: 'w-5 h-5', emoji: 'text-base', initials: 'text-[9px]' },
  md: { box: 'w-7 h-7', emoji: 'text-xl', initials: 'text-[11px]' },
  lg: { box: 'w-9 h-9', emoji: 'text-2xl', initials: 'text-[13px]' },
} as const;

/** What an agent's icon shows: an image, an emoji, or (neither) its initials. */
export interface AgentPictureSource {
  image: string | null;
  emoji: string | null;
}

/**
 * Resolve an agent's picture the way the rail does: the workspace's own image
 * or emoji, then its area's, then nothing (initials). Pure, for places that
 * render outside the app's providers, like the composer's `@` popup.
 */
export function resolveAgentPicture(
  workspace: Pick<WorkspaceRecord, 'attachments' | 'emoji' | 'areaId'>,
  areas: ReadonlyArray<Pick<AreaRecord, 'id' | 'attachments' | 'emoji'>> | undefined,
): AgentPictureSource {
  const ownImage = coverAttachmentUrl(workspace.attachments);
  const area = workspace.areaId ? areas?.find((a) => a.id === workspace.areaId) : undefined;
  const areaImage = area ? coverAttachmentUrl(area.attachments) : null;
  return {
    image: ownImage ?? (workspace.emoji ? null : areaImage),
    emoji: workspace.emoji ?? (ownImage ? null : area?.emoji ?? null),
  };
}

/**
 * An agent's icon, resolved the way the rail resolves it: the workspace's
 * own image or emoji, then its area's, then the initials of its name.
 */
export function AgentIcon({
  workspace,
  size = 'md',
  className,
}: {
  workspace: Pick<WorkspaceRecord, 'attachments' | 'emoji' | 'areaId' | 'name'>;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { data: areas } = useAreas();
  return <AgentPicture picture={resolveAgentPicture(workspace, areas)} name={workspace.name} size={size} className={className} />;
}

/** An already resolved agent picture. Needs no providers. */
export function AgentPicture({
  picture: { image, emoji },
  name,
  size = 'md',
  className,
}: {
  picture: AgentPictureSource;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const dims = SIZES[size];
  return (
    <span className={cn('relative flex items-center justify-center flex-shrink-0', dims.box, className)}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className={cn('rounded-md object-cover', dims.box)} />
      ) : emoji ? (
        <span className={cn('leading-none', dims.emoji)} aria-hidden>
          {emoji}
        </span>
      ) : (
        <AgentInitials name={name} size={size} />
      )}
    </span>
  );
}

/**
 * The tile an agent shows with no image or emoji: its initials, so agents
 * without pictures still look different from each other. For rows that
 * resolve the picture themselves; everything else uses `AgentIcon`.
 */
export function AgentInitials({ name, size = 'md' }: { name: string; size?: keyof typeof SIZES }) {
  const dims = SIZES[size];
  return (
    <span
      aria-hidden
      className={cn(
        'rounded-md flex items-center justify-center bg-muted text-muted-foreground font-bold tracking-wide',
        dims.box,
        dims.initials,
      )}
    >
      {agentInitials(name)}
    </span>
  );
}
