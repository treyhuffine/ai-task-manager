'use client';

import { Folder } from 'lucide-react';
import { useAreas } from '@/hooks/use-areas';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import type { WorkspaceRecord } from '@/db/types';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: { box: 'w-5 h-5', emoji: 'text-base', icon: 12 },
  md: { box: 'w-7 h-7', emoji: 'text-xl', icon: 15 },
  lg: { box: 'w-9 h-9', emoji: 'text-2xl', icon: 18 },
} as const;

/**
 * An agent's icon, resolved the way the rail resolves it: the workspace's
 * own image or emoji, then its area's, then a folder glyph.
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
  const dims = SIZES[size];
  const ownImage = coverAttachmentUrl(workspace.attachments);
  const area = workspace.areaId ? areas?.find((a) => a.id === workspace.areaId) : undefined;
  const areaImage = area ? coverAttachmentUrl(area.attachments) : null;
  const image = ownImage ?? (workspace.emoji ? null : areaImage);
  const emoji = workspace.emoji ?? (ownImage ? null : area?.emoji ?? null);

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
        <span className={cn('rounded-md flex items-center justify-center bg-muted text-muted-foreground', dims.box)}>
          <Folder size={dims.icon} aria-hidden />
        </span>
      )}
    </span>
  );
}
