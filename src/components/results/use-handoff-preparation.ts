'use client';

import { useSessionEvents } from '@/hooks/use-execution';

export function useHandoffPreparation(sessionId: string | null, target: { sourceEventId?: string; resultId?: string }) {
  const events = useSessionEvents(sessionId);
  // The shared events cache is already in chronological order.
  const rows = events.data ?? [];
  for (let index = rows.length - 1; index >= 0; index--) {
    const event = rows[index];
    const raw = event.raw as { resultOperation?: { kind?: string; resultId?: string | null; sourceEventId?: string | null; status?: string; statusReason?: string | null } } | null;
    const operation = raw?.resultOperation;
    if (operation?.kind !== 'handoff_preparation') continue;
    if ((target.resultId && operation.resultId === target.resultId) || (target.sourceEventId && operation.sourceEventId === target.sourceEventId)) {
      return { event, status: operation.status ?? 'queued', statusReason: operation.statusReason ?? null };
    }
  }
  return null;
}
