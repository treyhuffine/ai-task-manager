'use client';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/lib/trpc/client';
import { ExecutionEvent } from '@/components/chat-ui/activity/execution-event';

/** A PK lookup keeps exact links usable even far outside the loaded transcript page. */
export function LinkedCoordinationMessage({ sessionId }: { sessionId: string }) {
  const params = useSearchParams();
  const eventId = params.get('session') === sessionId ? params.get('message') : null;
  const { data, isLoading } = useQuery({ queryKey: ['coordination-linked-message', sessionId, eventId], queryFn: () => trpcClient.coordination.message.query({ sessionId, eventId: eventId! }), enabled: !!eventId });
  if (!eventId) return null;
  return <section className="rounded-xl border border-primary/30 bg-primary/5 p-3" aria-label="Linked message"><p className="mb-3 text-xs font-medium text-muted-foreground">Linked message</p>{isLoading ? <p className="text-xs">Loading message…</p> : data ? <ExecutionEvent event={data} sessionId={sessionId} /> : <p className="text-xs text-muted-foreground">This source message is no longer available.</p>}</section>;
}
