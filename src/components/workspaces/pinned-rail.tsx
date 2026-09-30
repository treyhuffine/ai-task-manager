'use client';

import { useMemo } from 'react';
import { Pin } from 'lucide-react';
import { useRailSessions } from '@/hooks/use-workspaces';
import { useInactivity } from '@/hooks/use-inactivity';
import { selectPinnedSessions } from '@/lib/utils/session-sort';
import { SessionRow } from './session-row';
import { InactiveFold } from './inactive-fold';

/**
 * The rail's "Pinned" group — a stable, cross-workspace shelf of the
 * executions the user has pinned to keep reachable while bouncing between
 * things. Rendered at the very top of the rail body (above the tab switch),
 * so pins are one glance away no matter which tab is open. The same
 * executions still appear in their natural home (under their workspace, in
 * their status bucket, in the history feed) — pinning surfaces, it doesn't
 * move.
 *
 * Derived from the existing rail query rather than a dedicated fetch: the
 * rail already returns every active execution with its `execution.pinnedAt`,
 * and pins only exist on active executions (archiving clears them), so a
 * filter is both sufficient and self-coherent with every other rail surface.
 * Ordered by pin time, most-recent first, so a fresh pin lands on top and the
 * list never reshuffles as agents work underneath it.
 *
 * Renders nothing when no execution is pinned, so it costs zero footprint
 * until the user opts in.
 *
 * A pin goes inactive like any execution (src/lib/sessions/inactive.ts): it
 * folds behind "N inactive hidden · Show" at the foot of the group, where it
 * shows dimmed with Unpin and Archive on hover. The count is active pins.
 */
export function PinnedRail() {
  const { data } = useRailSessions();
  const { partition } = useInactivity();

  const pinned = useMemo(
    () => selectPinnedSessions(data?.sessions ?? []),
    [data?.sessions],
  );
  const { active, inactive } = useMemo(() => partition(pinned), [partition, pinned]);

  if (pinned.length === 0) return null;

  const row = (s: (typeof pinned)[number], isInactive: boolean) => (
    <SessionRow
      key={s.id}
      session={s}
      // Cross-workspace shelf: name the workspace so a pin is
      // orientable without its folder header above it.
      showWorkspaceLabel={s.workspaceName ?? undefined}
      // The section title already says "Pinned"; a per-row glyph
      // would just repeat it here.
      hidePinMarker
      inactive={isInactive}
    />
  );

  return (
    <section className="flex flex-col pb-1 mb-0.5 border-b border-border/40">
      <div className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-1">
        <Pin size={9} className="fill-current text-muted-foreground/60 -rotate-45" aria-hidden />
        <span className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
          Pinned
        </span>
        {/* Active pins only. With every pin folded, no "0": the fold says it. */}
        {active.length > 0 && (
          <span className="text-[9px] tabular-nums text-muted-foreground/50">{active.length}</span>
        )}
      </div>
      <div className="px-1 space-y-0.5">
        {active.map((s) => row(s, false))}
        <InactiveFold sectionId="pinned" count={inactive.length} className="pl-8">
          {inactive.map((s) => row(s, true))}
        </InactiveFold>
      </div>
    </section>
  );
}
