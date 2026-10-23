'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { myRiClient } from '@/lib/spaces/my-ri-client';
import { invalidateTeamContent } from '@/lib/spaces/client-cache';
import { useConnectedTeams } from './space-selector';
import { teamDisplayName } from '@/lib/home/team-display-name';
import { apiErrorText } from '@/lib/api/client';

export function ImportedWorkNotice({ teamId }: { teamId: string }) {
  const teams = useConnectedTeams();
  const team = teams.data?.find((t) => t.id === teamId);
  const qc = useQueryClient();
  const refresh = useMutation({
    mutationFn: () => myRiClient.spaces.refresh.mutate({ force: true }),
    onSettled: () => invalidateTeamContent(qc),
  });
  if (!team) return null;
  const name = teamDisplayName(teamId, teams.data);
  const active = team.status === 'active';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-xs" role="status">
      <p className="min-w-0 flex-1">Imported work from {name}. These are tasks assigned to you or added to My Ri. Use Todo, Current Work or All to change the status view.</p>
      {active ? <a href={`/space/${encodeURIComponent(teamId)}`} className="font-medium underline underline-offset-2">Browse all team tasks</a> : <Link href="/?settings=teams" className="font-medium underline underline-offset-2">Reconnect in Settings</Link>}
      <p className="w-full text-muted-foreground">{!active ? (team.status === 'revoked' ? 'The team revoked this sign-in. Get a new sign-in link from the team.' : 'This team is disconnected. Connect it again to update shared work.') : team.lastError ?? (team.lastSyncedAt ? `Last updated ${new Date(team.lastSyncedAt).toLocaleString()}.` : 'Waiting for the first update. This list may be incomplete.')}{refresh.error ? ` ${apiErrorText(refresh.error)}` : ''} {active && <button className="underline underline-offset-2" disabled={refresh.isPending} onClick={() => refresh.mutate()}>{refresh.isPending ? 'Refreshing…' : team.lastError ? 'Retry' : 'Refresh'}</button>}</p>
    </div>
  );
}
