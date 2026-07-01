import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

/**
 * Morning-deck refresh config, backed by the app-managed cron trigger
 * (`RESERVED_TRIGGER_IDS.morningDeck`) via GET/PUT /api/deck/trigger. One
 * cache entry so every surface that reads or toggles it — the settings pane
 * and the deck toolbar — stays in sync.
 */
export interface MorningDeckConfig {
  enabled: boolean;
  /** Local HH:MM the refresh fires at. */
  time: string;
  timezone: string;
}

const MORNING_DECK_KEY = ['deck-trigger'] as const;

export function useMorningDeck() {
  return useQuery({
    queryKey: MORNING_DECK_KEY,
    queryFn: () => api.get<MorningDeckConfig>('/deck/trigger'),
  });
}

export function useUpdateMorningDeck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { enabled?: boolean; time?: string }) =>
      api.put<MorningDeckConfig>('/deck/trigger', input),
    // PUT echoes the full config back — seed the cache directly so the
    // toggle/time reflect immediately without a refetch round-trip.
    onSuccess: (cfg) => qc.setQueryData(MORNING_DECK_KEY, cfg),
  });
}
