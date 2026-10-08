'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FileCheck2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import { usePrepareHandoff, useResultCapabilities, useSaveHandoff } from '@/hooks/use-results';
import { workResultsApi } from '@/lib/api/results';
import type { ChatEventRecord } from '@/lib/api/dto/records';
import { useAuthoringDestination } from './use-authoring-destination';
import { useHandoffPreparation } from './use-handoff-preparation';
import { resultRequestKey } from './request-key';

/** Recovery actions are explicit, no message classification or automatic packaging. */
export function OutputHandoffActions({ event, sessionId }: { event: ChatEventRecord; sessionId: string }) {
  const { data: capabilities } = useResultCapabilities();
  const enabled = capabilities?.handoffsEnabled === true;
  const destination = useAuthoringDestination(sessionId, enabled);
  const saved = useQuery({
    queryKey: ['results', 'source', sessionId, event.id],
    queryFn: () => workResultsApi.listForSource(sessionId, event.id),
    enabled,
    staleTime: 5_000,
  });
  const handoff = saved.data?.[0];
  const save = useSaveHandoff();
  const prepare = usePrepareHandoff();
  const previousPreparation = useHandoffPreparation(enabled ? sessionId : null, { sourceEventId: event.id });
  const status = previousPreparation?.status ?? prepare.data?.status;
  const activePreparation = status === 'queued' || status === 'running';
  const retryPreparation = status === 'failed' || status === 'cancelled';
  if (!enabled || !event.content?.trim()) return null;
  const resultId = save.data?.resultId ?? handoff?.id ?? prepare.data?.resultId;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      {resultId ? <Link href={`/results/${resultId}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-primary hover:bg-muted"><FileCheck2 size={12} />View handoff</Link> : <>
        <Button size="xs" variant="ghost" disabled={save.isPending || prepare.isPending} onClick={() => save.mutate({ requestId: `save-answer:${event.id}`, sourceChatSessionId: sessionId, sourceEventId: event.id, body: event.content!, attachments: event.attachments ?? [] })}>
          {save.isPending && <Loader2 className="animate-spin" />}Save as handoff
        </Button>
        <Tip label={destination.reason}><Button size="xs" variant="ghost" disabled={prepare.isPending || save.isPending || activePreparation || !destination.available} onClick={() => prepare.mutate({ requestId: retryPreparation ? resultRequestKey('retry-preparation', { sourceEventId: event.id, previousMessageId: prepare.data?.messageId ?? previousPreparation?.event.id }) : `prepare-answer:${event.id}`, sourceChatSessionId: sessionId, sourceEventId: event.id })}>
          {(prepare.isPending || activePreparation) && <Loader2 className="animate-spin" />}{retryPreparation ? 'Retry preparation' : activePreparation ? 'Preparing handoff' : 'Prepare handoff'}
        </Button></Tip>
      </>}
      {status && !resultId && <span className="text-muted-foreground">Handoff preparation: {status}{(previousPreparation?.statusReason ?? prepare.data?.statusReason) ? ` (${(previousPreparation?.statusReason ?? prepare.data?.statusReason)!.replaceAll('_', ' ')})` : ''}</span>}
    </div>
  );
}
