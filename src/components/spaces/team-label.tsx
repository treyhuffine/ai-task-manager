'use client';

import { Users } from 'lucide-react';
import { Tip } from '@/components/ui/tip';
import { useConnectedTeams } from './space-selector';

/**
 * The team a shared task or saved note in My Ri belongs to (docs/homes-spec.md
 * §3.2): shown wherever it appears, whatever personal Area it's organized under.
 */
export function TeamLabel({ teamId }: { teamId: string | null | undefined }) {
  const teams = useConnectedTeams();
  if (!teamId) return null;
  const name = teams.data?.find((t) => t.id === teamId)?.name ?? 'Team';
  return (
    <Tip label={`Shared with ${name}`}>
      <span className="inline-flex max-w-[10rem] items-center gap-1 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary/90">
        <Users size={9} className="flex-shrink-0" />
        <span className="truncate">{name}</span>
      </span>
    </Tip>
  );
}
