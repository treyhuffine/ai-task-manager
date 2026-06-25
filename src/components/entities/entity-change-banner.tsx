'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Undo2, X, Loader2, Eye } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useEntityVersions, groupVersions, type VersionedEntityType } from '@/hooks/use-entity-versions';
import { EntityDiffModal } from './entity-diff-modal';

/**
 * Prominent "the AI just changed this" CTA, pinned above the note/task body.
 * This is the loud, can't-miss entry point to review + undo — the inline chat
 * chip and header button are easy to overlook. Appears only for a fresh
 * agent change the user hasn't reviewed/dismissed; a later human or revert
 * edit (or dismissing it) clears it.
 */
export function EntityChangeBanner({
  entityType,
  entityId,
}: {
  entityType: VersionedEntityType;
  entityId: string;
}) {
  const qc = useQueryClient();
  const { data } = useEntityVersions(entityType, entityId);
  const groups = groupVersions(data?.versions ?? []);
  const latest = groups[0];
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const revert = useMutation({
    mutationFn: (versionId: string) => api.post(`/entity-versions/${versionId}/revert`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: [entityType, entityId] });
      qc.invalidateQueries({ queryKey: ['entity-versions', entityType, entityId] });
      qc.invalidateQueries({ queryKey: ['deck'] });
    },
  });

  // Only surface a fresh agent edit the user hasn't acted on.
  if (!latest || latest.source !== 'ai' || dismissedId === latest.after.id) return null;

  const noun = entityType;
  const verb = latest.count > 1 ? `made ${latest.count} edits to` : 'edited';

  return (
    <>
      <div className="sticky top-0 z-20 mx-4 mt-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 shadow-sm backdrop-blur md:mx-12">
        <Sparkles size={15} className="flex-shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-[12.5px] text-foreground">
          AI {verb} this {noun}.
        </span>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11.5px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Eye size={12} /> Review changes
        </button>
        {latest.before && (
          <button
            onClick={() => revert.mutate(latest.before!.id)}
            disabled={revert.isPending}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1 text-[11.5px] font-medium text-foreground hover:bg-muted/60 disabled:opacity-50"
          >
            {revert.isPending ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />} Undo
          </button>
        )}
        <button
          onClick={() => setDismissedId(latest.after.id)}
          className="flex-shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
      {modalOpen && (
        <EntityDiffModal open={modalOpen} onClose={() => setModalOpen(false)} entityType={entityType} entityId={entityId} />
      )}
    </>
  );
}
