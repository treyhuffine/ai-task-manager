'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { useResultCapabilities } from '@/hooks/use-results';
import { workResultsApi } from '@/lib/api/results';
import { apiErrorText } from '@/lib/api/client';

export function ResultPilotSettings() {
  const capabilities = useResultCapabilities();
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: workResultsApi.setCapabilities,
    onSuccess: (value) => qc.setQueryData(['results', 'capabilities'], value),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['results'] }); },
  });
  if (capabilities.error) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-[12px] font-medium text-foreground">Handoffs</h3>
      <div className="space-y-3 rounded-lg border bg-background p-3">
        <label className="flex items-center justify-between gap-3"><div><p className="text-sm">Durable handoffs</p><p className="text-[11px] text-muted-foreground">Save useful agent work, files and links in the conversation.</p></div><Switch checked={capabilities.data?.handoffsEnabled ?? false} disabled={!capabilities.data || update.isPending} onCheckedChange={(handoffsEnabled) => update.mutate({ handoffsEnabled })} /></label>
        <label className="flex items-center justify-between gap-3"><div><p className="text-sm">AI review</p><p className="text-[11px] text-muted-foreground">Request an independent review, or let an agent&apos;s enabled review preference request it.</p></div><Switch checked={capabilities.data?.aiReviewEnabled ?? false} disabled={!capabilities.data?.handoffsEnabled || update.isPending} onCheckedChange={(aiReviewEnabled) => update.mutate({ aiReviewEnabled })} /></label>
        <p className="text-[11px] text-muted-foreground">Both are optional. Turning them off keeps saved handoffs and reports readable. Running work can finish or be cancelled.</p>
        {update.error && <p role="alert" className="text-xs text-destructive">{apiErrorText(update.error)}</p>}
      </div>
    </section>
  );
}
