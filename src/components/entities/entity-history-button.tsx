'use client';

import { useState } from 'react';
import { History } from 'lucide-react';
import { useEntityVersions, groupVersions, type VersionedEntityType } from '@/hooks/use-entity-versions';
import { EntityDiffModal } from './entity-diff-modal';
import { cn } from '@/lib/utils';
import { ENTITY_HEADER_LABEL } from './entity-header';
import { Tip } from '@/components/ui/tip';

/**
 * Top-level "review changes" affordance for a note/task — the discoverable
 * entry point to the diff/undo modal, so reviewing what the AI changed isn't
 * buried in a chat tool call. Hidden until the entity has change history;
 * emphasized (primary) when the most recent change was the agent's, so a
 * fresh AI edit reads as "review me."
 */
export function EntityHistoryButton({
  entityType,
  entityId,
  className,
}: {
  entityType: VersionedEntityType;
  entityId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data } = useEntityVersions(entityType, entityId);
  const groups = groupVersions(data?.versions ?? []);

  if (groups.length === 0) return null;

  const aiLatest = groups[0].source === 'ai';

  return (
    <>
      <Tip label={aiLatest ? 'Review changes' : 'History'}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={aiLatest ? 'Review changes' : 'History'}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
            aiLatest
              ? 'bg-primary/10 text-primary hover:bg-primary/20'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            className,
          )}
        >
          <History size={12} />
          <span className={ENTITY_HEADER_LABEL}>{aiLatest ? 'Review changes' : 'History'}</span>
        </button>
      </Tip>
      {open && (
        <EntityDiffModal open={open} onClose={() => setOpen(false)} entityType={entityType} entityId={entityId} />
      )}
    </>
  );
}
