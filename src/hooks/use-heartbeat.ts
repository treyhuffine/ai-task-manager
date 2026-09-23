import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, apiErrorText } from '@/lib/api/client';
import { triggersApi } from '@/lib/api/triggers';
import type { EffortLevel } from '@/db/types';
import type { HarnessId } from '@/lib/harness/registry';
import type { HeartbeatConfig } from '@/lib/heartbeat/types';

/**
 * The heartbeat's settings and status, backed by the app-managed heartbeat
 * trigger via GET/PUT /api/heartbeat (the get_heartbeat / update_heartbeat
 * actions). One cache entry, so Settings > Heartbeat and the deck chip always
 * agree. See docs/heartbeat-spec.md.
 */

export const HEARTBEAT_KEY = ['heartbeat'] as const;

/** What the settings surfaces can change. Mirrors `update_heartbeat`. */
export interface HeartbeatUpdate {
  enabled?: boolean;
  instructions?: string;
  resetInstructions?: boolean;
  intervalSeconds?: number;
  activeHoursStart?: string | null;
  activeHoursEnd?: string | null;
  timezone?: string;
  provider?: HarnessId;
  model?: string | null;
  effort?: EffortLevel | null;
  deliverResultTo?: string[];
}

export function useHeartbeat() {
  return useQuery({
    queryKey: HEARTBEAT_KEY,
    queryFn: () => api.get<HeartbeatConfig>('/heartbeat'),
    // Check-ins land in the background. Poll quickly while one runs so the
    // chip flips from "checking in" to its result without a reload.
    refetchInterval: (query) => (query.state.data?.running ? 5_000 : 30_000),
  });
}

/** Apply the fields the server would echo, so toggles and pickers respond instantly. */
function optimisticConfig(prev: HeartbeatConfig, patch: HeartbeatUpdate): HeartbeatConfig {
  const next: HeartbeatConfig = { ...prev };
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.instructions !== undefined) next.instructions = patch.instructions;
  if (patch.intervalSeconds !== undefined) next.intervalSeconds = patch.intervalSeconds;
  if (patch.activeHoursStart !== undefined) next.activeHoursStart = patch.activeHoursStart;
  if (patch.activeHoursEnd !== undefined) next.activeHoursEnd = patch.activeHoursEnd;
  if (patch.timezone !== undefined) next.timezone = patch.timezone;
  if (patch.provider !== undefined && patch.provider !== prev.provider) {
    next.provider = patch.provider;
    next.model = patch.model ?? null;
    next.effort = patch.effort ?? null;
  }
  if (patch.model !== undefined) next.model = patch.model;
  if (patch.effort !== undefined) next.effort = patch.effort;
  if (patch.deliverResultTo !== undefined) next.deliverResultTo = patch.deliverResultTo;
  return next;
}

export function useUpdateHeartbeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: HeartbeatUpdate) => api.put<HeartbeatConfig>('/heartbeat', patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: HEARTBEAT_KEY });
      const prev = qc.getQueryData<HeartbeatConfig>(HEARTBEAT_KEY);
      if (prev) qc.setQueryData(HEARTBEAT_KEY, optimisticConfig(prev, patch));
      return { prev };
    },
    onError: (err, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(HEARTBEAT_KEY, ctx.prev);
      toast.error(`Couldn't update the heartbeat: ${apiErrorText(err)}`);
    },
    onSuccess: (config) => {
      // PUT echoes the whole config (with the recomputed next check-in).
      qc.setQueryData(HEARTBEAT_KEY, config);
      // The Triggers screen shows the same row.
      void qc.invalidateQueries({ queryKey: ['triggers'] });
    },
  });
}

/** "Check in now": fire the heartbeat trigger once, outside its schedule. */
export function useCheckInNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (triggerId: string) => triggersApi.run(triggerId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: HEARTBEAT_KEY });
      void qc.invalidateQueries({ queryKey: ['triggers'] });
      void qc.invalidateQueries({ queryKey: ['runs'] });
    },
    onError: (err) => toast.error(`Couldn't start a check-in: ${apiErrorText(err)}`),
  });
}
