'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateTeamContent, teamConnectionsKey } from '@/lib/spaces/client-cache';
import { myRiClient } from '@/lib/spaces/my-ri-client';
import { useConnectedTeams } from './space-selector';

/** How often an open window asks whether the home's own pass changed anything. */
const POLL_MS = 60_000;

/**
 * Keep My Ri's view of its teams' work current (docs/homes-spec.md §9.3,
 * poll for changes and refresh on focus). The home reads its teams every two
 * minutes. An open window polls a cheap counter that moves whenever a pass
 * changes something, and coming back to the window asks for a pass of its
 * own. The home runs one pass at a time and shares requests close together,
 * so every window can ask. Task lists reload only when a pass changed them,
 * and the teams list after each pass, for its last-read time and any problem.
 */
export function useTeamRefresh() {
  const qc = useQueryClient();
  const teams = useConnectedTeams();
  const connected = (teams.data ?? []).some((t) => t.status === 'active');
  const seen = useRef<number | null>(null);

  // `changedNow`: the answer came from a pass that changed something, which
  // lists loaded before this window first heard a generation may predate.
  const observe = useCallback(
    (generation: number, changedNow = false) => {
      const first = seen.current === null;
      if (first ? changedNow : generation !== seen.current) invalidateTeamContent(qc);
      seen.current = generation;
    },
    [qc],
  );

  const poll = useQuery({
    queryKey: ['my-ri', 'spaces', 'generation'],
    queryFn: () => myRiClient.spaces.generation.query(),
    enabled: connected,
    refetchInterval: POLL_MS,
    staleTime: 0,
  });
  const polled = poll.data?.generation;
  useEffect(() => {
    if (polled !== undefined) observe(polled);
  }, [polled, observe]);

  useEffect(() => {
    if (!connected) return;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const { generation, teams: results } = await myRiClient.spaces.refresh.mutate();
        observe(generation, results.some((r) => r.changed > 0));
        void qc.invalidateQueries({ queryKey: teamConnectionsKey() });
      } catch {
        // The home is out of reach: its own banner says so.
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [connected, observe, qc]);
}
