'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { workResultsApi } from '@/lib/api/results';
import { apiErrorText } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import type { ChatEventRecord } from '@/lib/api/dto/records';

export function PreparationStatus({ event }: { event: ChatEventRecord }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => workResultsApi.cancelPreparation(event.id),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['session', event.sessionId, 'events'] }); },
  });
  const raw = event.raw as { resultOperation?: { kind?: string; status?: string; statusReason?: string | null } } | null;
  const operation = raw?.resultOperation;
  if (operation?.kind !== 'handoff_preparation') return null;
  return <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
    <span>Handoff preparation: {operation.status ?? 'queued'}{operation.statusReason ? ` (${operation.statusReason.replaceAll('_', ' ')})` : ''}</span>
    {(!operation.status || operation.status === 'queued') && <Button size="xs" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Cancel preparation</Button>}
    {!!cancel.error && <span role="alert" className="text-destructive">{apiErrorText(cancel.error)}</span>}
  </div>;
}
