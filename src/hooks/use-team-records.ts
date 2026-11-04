'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOptionalHomeContext } from '@/components/home/home-context';
import { useOptionalWorkNavigation } from '@/contexts/work-context';
import type { RemoteRecordKind } from '@/lib/entity-refs/parse-markers';
import { currentSpaceId, spacePlaceKey, spaceRecordPath } from '@/lib/spaces/document';
import type { TeamRecordView } from '@/lib/spaces/team-links';
import { trpc, trpcClient } from '@/lib/trpc/client';

/** Whether this document is My Ri. A team's own document can only reach that team. */
export function useInMyRi(): boolean {
  const home = useOptionalHomeContext();
  return home?.home.kind !== 'team' && !currentSpaceId();
}

/** A link to a record in a team: what it is, or why it can't be read. */
export function useTeamRecord(kind: RemoteRecordKind, homeId: string, id: string, enabled = true) {
  const input = { kind, homeId, id };
  return useQuery({
    queryKey: trpc.spaces.record.queryKey(input),
    queryFn: () => trpcClient.spaces.record.query(input),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

/** Where a bare ID that isn't in this Home really is. */
export function useLocatedRecord(kind: RemoteRecordKind, id: string, enabled = true) {
  const input = { kind, id };
  return useQuery({
    queryKey: trpc.spaces.locateRecord.queryKey(input),
    queryFn: () => trpcClient.spaces.locateRecord.query(input),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Open a team's record: a shared copy in place, otherwise the team's own view.
 * That's a whole page in this tab, or in the desktop app's one window, since a
 * team is a document of its own (src/lib/spaces/document.ts). Running work
 * carries on, and the way back is Back or the space selector, so this place is
 * saved for the selector as it is when choosing a space there.
 */
export function useOpenTeamRecord() {
  const navigation = useOptionalWorkNavigation();
  return useCallback((kind: RemoteRecordKind, id: string, view: Pick<TeamRecordView, 'homeId' | 'localId'>) => {
    if (view.localId && kind !== 'area') {
      if (!navigation) window.location.assign(`/${kind}/${view.localId}`);
      else if (kind === 'task') navigation.openTask(view.localId);
      else navigation.openNote(view.localId);
      return;
    }
    try {
      sessionStorage.setItem(spacePlaceKey(currentSpaceId()), window.location.pathname + window.location.search);
    } catch {
      // Without session storage the selector opens My Ri at its start.
    }
    window.location.assign(spaceRecordPath(view.homeId, kind, id));
  }, [navigation]);
}
