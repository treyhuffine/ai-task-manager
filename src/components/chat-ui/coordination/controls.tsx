'use client';
import { useChatCapabilities } from '@/components/chat-ui/chat-capabilities';
import { Pause, Play, MessagesSquare, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCoordinationState, useCoordinationHold, useCoordinationPolicy } from '@/hooks/use-coordination';
import { Tip } from '@/components/ui/tip';
import { ChatMessageLink } from '@/components/chat-ui/messages/chat-message-link';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/lib/trpc/client';

/** Quiet until a send is approved and in flight, or the human has paused it. */
export function CoordinationControls({ sessionId }: { sessionId: string }) {
  const enabled = useChatCapabilities().coordination !== false;
  return enabled ? <AvailableCoordinationControls {...{ sessionId }} /> : null;
}
function AvailableCoordinationControls({ sessionId }: { sessionId: string }) {
  const { data } = useCoordinationState(sessionId);
  if (!data || (!data.heldAt && !data.active.starting && data.active.chatIds.length === 0 && data.pending === 0)) return null;
  return <div aria-label="Chat collaboration" className="flex min-w-0 items-center justify-between gap-3 rounded-t-xl border-b border-border/60 bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
    <div className="min-w-0 flex-1 space-y-0.5 leading-4">
    {data.heldAt ? <span role="status" className="text-amber-700 dark:text-amber-400">Incoming agent messages paused{data.pending > 0 ? ` · ${data.pending} waiting` : ''}</span>
      : data.active.chatIds.length === 1 ? <ChatMessageLink sessionId={data.active.chatIds[0]} label="Working with" direction="outgoing" compact />
      : data.active.chatIds.length > 1 ? <Popover><PopoverTrigger asChild><button type="button" className="inline-flex items-center gap-1 underline underline-offset-2"><MessagesSquare size={12} />Working with {data.active.chatIds.length} chats<ChevronDown size={11} /></button></PopoverTrigger><PopoverContent align="start" className="max-h-72 w-80 space-y-2 overflow-y-auto">{data.active.chatIds.map(id => <ChatMessageLink key={id} sessionId={id} label="Active chat" direction="outgoing" />)}</PopoverContent></Popover>
      : <span role="status">{data.active.starting ? 'Starting another chat' : 'Incoming agent messages waiting'}</span>}
    {data.heldAt && data.assignmentsWaiting > 0 && <p>{data.assignmentsWaiting} assignment{data.assignmentsWaiting === 1 ? '' : 's'} waiting</p>}
    </div>
    <IncomingPauseButton sessionId={sessionId} />
  </div>;
}

function IncomingPauseButton({ sessionId }: { sessionId: string }) {
  const { data } = useCoordinationState(sessionId);
  const hold = useCoordinationHold(sessionId);
  if (!data) return null;
  return <Tip label="Queues incoming agent messages in this chat. Your messages still run, and work already running continues."><button type="button" aria-pressed={!!data.heldAt} disabled={hold.isPending} onClick={() => hold.mutate(!data.heldAt)} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted disabled:opacity-50">
    {data.heldAt ? <Play size={12} /> : <Pause size={12} />}{data.heldAt ? 'Resume' : 'Pause incoming'}
  </button></Tip>;
}

/** Standing preferences live in the chat menu, away from everyday input. */
export function CoordinationSettings({ sessionId }: { sessionId: string }) {
  const enabled = useChatCapabilities().coordination !== false;
  return enabled ? <AvailableCoordinationSettings sessionId={sessionId} /> : null;
}
function AvailableCoordinationSettings({ sessionId }: { sessionId: string }) {
  const { data } = useCoordinationState(sessionId);
  const policy = useCoordinationPolicy();
  if (!data) return null;
  return <div className="space-y-3 text-xs">
    <p className="font-medium">Messages to other chats</p>
    {data.unrestricted ? <p className="text-muted-foreground">Manager chats are unrestricted. This chat can message other chats and start new ones without coordination approval. Execution and other chats still follow their saved preferences.</p> : <>
    <p className="text-muted-foreground">{data.policy === 'allow' ? 'Allow automatically' : 'Ask first'}{data.source === 'default' ? ' by default' : `, from ${data.source === 'global' ? 'your default' : `this ${data.source}`}`}.</p>
    {data.levels.filter(level => level.source !== 'global').map(level => {
      const id = data.scopes[level.source];
      if (!id) return null;
      return <label key={level.source} className="flex min-w-0 items-center justify-between gap-3"><span>{level.source === 'chat' ? 'This chat' : level.source === 'execution' ? 'All chats in this execution' : 'This agent'}</span><select aria-label={`Coordination for ${level.source}`} className="min-w-0 max-w-40 rounded border bg-background p-1" value={level.value ?? ''} disabled={policy.isPending} onChange={event => policy.mutate({ scope: level.source, id, policy: event.target.value === 'ask' ? 'ask' : event.target.value === 'allow' ? 'allow' : null })}><option value="">Inherit</option><option value="ask">Ask first</option><option value="allow">Allow automatically</option></select></label>;
    })}
    <p className="text-muted-foreground">Applies to new sends. Approved messages keep their authorization.</p>
    </>}
    {data.unrestricted && data.approvals.length > 0 && <p className="text-muted-foreground">Earlier sends still await your decision. Open their approval cards to approve or decline.</p>}
    <div className="border-t pt-2"><IncomingPauseButton sessionId={sessionId} /><p className="mt-1 text-muted-foreground">Pause queues incoming agent messages in this chat. Your messages still run. Work already running continues.</p></div>
  </div>;
}

export function DefaultCoordinationSetting() {
  const { data } = useQuery({ queryKey: ['coordination', 'defaults'], queryFn: () => trpcClient.coordination.defaults.query() });
  const mutation = useCoordinationPolicy();
  return <div className="space-y-2"><label className="flex items-center justify-between gap-3 text-sm"><span>Default coordination</span><select aria-label="Default coordination" className="rounded-md border bg-background px-2 py-1" value={data?.global ?? 'ask'} disabled={mutation.isPending} onChange={event => mutation.mutate({ scope: 'global', id: '1', policy: event.target.value === 'allow' ? 'allow' : 'ask' })}><option value="ask">Ask first</option><option value="allow">Allow automatically</option></select></label><p className="text-xs text-muted-foreground">Applies to execution and other chats. Agent, execution and chat overrides take precedence. Agent main chats and Ri&apos;s main chat are unrestricted. Already approved sends keep their authorization.</p></div>;
}

export function IncomingDeliveryStatus({sessionId,deliveryId}:{sessionId:string;deliveryId:string}) {
  const {data}=useCoordinationState(sessionId);
  const status=data?.incoming?.[deliveryId];
  if(!status) return null;
  return <p role="status" className="px-3 pb-2 text-[11px] text-muted-foreground">{status==='delivered' ? data?.heldAt ? 'Waiting for you to resume incoming messages' : 'Queued for an eligible turn' : status==='failed' ? 'Could not supply this message to an agent turn' : 'Cancelled before acceptance'}</p>;
}
