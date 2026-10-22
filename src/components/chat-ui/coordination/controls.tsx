'use client';
import { Pause, Play, MessagesSquare, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCoordinationState, useCoordinationHold, useCoordinationPolicy } from '@/hooks/use-coordination';
import { useSession } from '@/hooks/use-execution';
import { ChatMessageLink } from '@/components/chat-ui/messages/chat-message-link';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/lib/trpc/client';

export function CoordinationControls({ sessionId }: { sessionId: string }) {
  const { data } = useCoordinationState(sessionId);
  const { data: session } = useSession(sessionId);
  const hold = useCoordinationHold(sessionId);
  const policy = useCoordinationPolicy();
  if (!data) return null;
  return <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
    <button type="button" aria-pressed={!!data.heldAt} disabled={hold.isPending} onClick={() => hold.mutate(!data.heldAt)} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 ${data.heldAt ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'border-border text-muted-foreground hover:bg-muted'}`}>
      {data.heldAt ? <Play size={12} /> : <Pause size={12} />}{data.heldAt ? `Hold on · ${data.pending} waiting · Release Hold` : 'Hold this chat'}
    </button>
    {data.heldAt && data.assignmentsWaiting > 0 && <span className="text-muted-foreground">{data.assignmentsWaiting} assignment{data.assignmentsWaiting === 1 ? '' : 's'} waiting for release</span>}
    <Popover><PopoverTrigger asChild><button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"><MessagesSquare size={12} />Coordination: {data.policy === 'allow' ? 'Allow automatically' : 'Ask first'}<ChevronDown size={11} /></button></PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 text-xs">
        <p className="font-medium">Sending to other chats</p><p className="text-muted-foreground">Effective setting: {data.policy === 'allow' ? 'Allow automatically' : 'Ask first'}, from {data.source}.</p>
        {data.levels.filter(level => level.source !== 'global').map(level => {
          const id = level.source === 'chat' ? sessionId : level.source === 'execution' ? session?.executionId : session?.workspaceId;
          if (!id) return null;
          return <label key={level.source} className="flex items-center justify-between gap-3"><span>{level.source === 'chat' ? 'This chat' : level.source === 'execution' ? 'All chats in this execution' : 'This agent'}</span><select aria-label={`Coordination for ${level.source}`} className="max-w-40 rounded border bg-background p-1" value={level.value ?? ''} disabled={policy.isPending} onChange={event => policy.mutate({ scope: level.source, id, policy: event.target.value === 'ask' ? 'ask' : event.target.value === 'allow' ? 'allow' : null })}><option value="">Inherit</option><option value="ask">Ask first</option><option value="allow">Allow automatically</option></select></label>;
        })}
        <p className="text-muted-foreground">Changes apply to new sends. Approved sends stay authorized. Hold keeps incoming messages visible without starting or injecting a turn in this chat. Your own sends still run. Stop interrupts current work separately.</p>
        {data.related.length > 0 && <div className="space-y-1 border-t pt-2"><p className="text-muted-foreground">Related chats</p>{data.related.slice(0, 5).map(chat => <ChatMessageLink key={chat.id} sessionId={chat.id} label="Related chat" direction="outgoing" />)}</div>}
      </PopoverContent></Popover>
  </div>;
}
export function DefaultCoordinationSetting() {
  const { data } = useQuery({ queryKey: ['coordination', 'defaults'], queryFn: () => trpcClient.coordination.defaults.query() });
  const mutation = useCoordinationPolicy();
  return <div className="space-y-2"><label className="flex items-center justify-between gap-3 text-sm"><span>Default coordination</span><select aria-label="Default coordination" className="rounded-md border bg-background px-2 py-1" value={data?.global ?? 'ask'} disabled={mutation.isPending} onChange={event => mutation.mutate({ scope: 'global', id: '1', policy: event.target.value === 'allow' ? 'allow' : 'ask' })}><option value="ask">Ask first</option><option value="allow">Allow automatically</option></select></label><p className="text-xs text-muted-foreground">Allow agents to message chats and start new chats within your intent. Agent, execution and chat overrides take precedence. Already approved sends keep their authorization.</p></div>;
}

export function IncomingDeliveryStatus({sessionId,deliveryId}:{sessionId:string;deliveryId:string}) {
  const {data}=useCoordinationState(sessionId);
  const status=data?.incoming?.[deliveryId];
  if(!status) return null;
  return <p role="status" className="px-3 pb-2 text-[11px] text-muted-foreground">{status==='delivered' ? data?.heldAt ? 'Waiting for Hold release' : 'Queued for an eligible turn' : status==='failed' ? 'Could not supply this message to an agent turn' : 'Cancelled before acceptance'}</p>;
}
