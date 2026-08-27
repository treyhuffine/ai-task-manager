'use client';

import { Link2, SquareCheckBig, StickyNote, Unlink } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useBacklinks, type LinkEntityType } from '@/hooks/use-backlinks';

/**
 * "Linked references" — the notes/tasks whose body links to this entity
 * (backlinks), plus a count of any unresolved outgoing links. Renders
 * nothing when there is nothing to show, so it never clutters an unlinked
 * document. Backlinks are the value here: they are not otherwise visible in
 * the document the way the outgoing `[[ ]]` links already are.
 */
export function LinkedReferences({
  entityType,
  entityId,
}: {
  entityType: LinkEntityType;
  entityId: string;
}) {
  const { openTask, openNote } = useDashboard();
  const { data, isError } = useBacklinks(entityType, entityId);

  // Surface a load failure distinctly rather than letting it read as "no
  // references" (an empty panel would otherwise hide the error).
  if (isError) {
    return (
      <div className="border-t border-border pt-4 mt-2">
        <div className="flex items-center gap-1.5 text-xs text-destructive/80">
          <Link2 className="w-3.5 h-3.5" />
          Could not load linked references.
        </div>
      </div>
    );
  }

  const backlinks = data?.backlinks ?? [];
  const unresolvedCount = (data?.outgoing ?? []).filter((o) => !o.resolved).length;
  if (backlinks.length === 0 && unresolvedCount === 0) return null;

  const open = (type: LinkEntityType, id: string) =>
    type === 'task' ? openTask(id) : openNote(id);

  return (
    <div className="border-t border-border pt-4 mt-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
        <Link2 className="w-3.5 h-3.5" />
        Linked references
        {backlinks.length > 0 && (
          <span className="text-muted-foreground/60">{backlinks.length}</span>
        )}
      </div>

      {backlinks.length > 0 && (
        <ul className="space-y-0.5">
          {backlinks.map((b) => {
            const Icon = b.sourceType === 'task' ? SquareCheckBig : StickyNote;
            const label =
              b.title?.trim() || (b.sourceType === 'task' ? 'Untitled task' : 'Untitled note');
            return (
              <li key={`${b.sourceType}:${b.sourceId}`}>
                <button
                  type="button"
                  onClick={() => open(b.sourceType, b.sourceId)}
                  className="flex items-center gap-2 w-full text-left text-sm rounded px-2 py-1 hover:bg-accent text-foreground/90"
                >
                  <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {unresolvedCount > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70 mt-2 px-2">
          <Unlink className="w-3.5 h-3.5" />
          {unresolvedCount} unresolved link{unresolvedCount === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}
