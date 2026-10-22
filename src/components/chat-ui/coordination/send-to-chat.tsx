'use client';
import { useDeferredValue, useState } from 'react';
import { Forward, Search } from 'lucide-react';
import { uuidv7 } from 'uuidv7';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tip } from '@/components/ui/tip';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { useDefaultSelection } from '@/hooks/use-default-selection';
import { useHarnessModels } from '@/hooks/use-harness-models';
import { ModelControl, type LaunchHarnessSelection } from '@/components/workspaces/launcher/model-controls';
import { trpcClient } from '@/lib/trpc/client';
import { DEFAULT_HARNESS } from '@/lib/harness/registry';
import { toast } from 'sonner';

export function SendToChatButton({ eventId, sessionId }: { eventId: string; sessionId: string }) {
  const [open, setOpen] = useState(false);
  return <><Tip label="Share this message with another chat"><button type="button" aria-label="Send to chat" onClick={() => setOpen(true)} className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground"><Forward size={12} /></button></Tip>
    {open && <SendToChatDialog eventId={eventId} sessionId={sessionId} onClose={() => setOpen(false)} />}</>;
}
function SendToChatDialog({ eventId, sessionId, onClose }: { eventId: string; sessionId: string; onClose: () => void }) {
  const defaults = useDefaultSelection();
  const [sendId] = useState(uuidv7);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [workspaceId, setWorkspaceId] = useState('');
  const [target, setTarget] = useState('');
  const [newChat, setNewChat] = useState(false);
  const [directions, setDirections] = useState('');
  const [selection, setSelection] = useState<LaunchHarnessSelection | null>(null);
  const harness = selection?.harness ?? defaults?.harness ?? DEFAULT_HARNESS;
  const model = selection ? selection.model ?? '' : defaults?.model ?? '';
  const effort = selection ? selection.effort : defaults?.effort ?? null;
  const variant = selection ? selection.variant : defaults?.variant ?? null;
  const serviceTier = selection ? selection.serviceTier : defaults?.serviceTier;
  const { models } = useHarnessModels(harness);
  const selectedModel = models.find(option => option.id === model) ?? null;
  const { data: agents = [] } = useWorkspaces({ status: 'active' });
  const { data: chats = [], isLoading } = useQuery({ queryKey: ['coordination-targets', deferredSearch, workspaceId, sessionId], queryFn: () => trpcClient.coordination.targets.query({ search: deferredSearch, ...(workspaceId ? { workspaceId } : {}), excludeSessionId: sessionId }) });
  const send = useMutation({ mutationFn: () => trpcClient.coordination.forward.mutate({ sendId, sourceEventId: eventId, directions,
    ...(newChat ? { launch: { workspaceId, ...(selection ? { provider: harness, ...(model ? { model } : {}), modelVariant: variant, effort, serviceTier } : {}) } } : { target }) }),
    meta: { carriesInput: true }, onSuccess: () => { toast.success('Message saved for delivery.'); onClose(); }, onError: error => toast.error(error.message) });
  // In-tree model popovers need a viewport containing block. A centered
  // transform on the dialog would clip them inside its scroll container.
  return <Dialog open onOpenChange={open => { if (!open && !send.isPending) onClose(); }}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" style={{ inset: '1rem 0 auto', marginInline: 'auto', translate: 'none', transform: 'none', animation: 'none' }}><DialogHeader><DialogTitle>Send to chat</DialogTitle><DialogDescription>Share the full message and its attachments. Add directions if useful. No automatic answer is sent back.</DialogDescription></DialogHeader>
    <div className="space-y-3">
      <label className="flex items-center gap-2 rounded-md border px-2 py-1.5"><Search size={14} className="text-muted-foreground" /><input autoFocus aria-label="Search chats" placeholder="Search chats" value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
      <label className="flex items-center justify-between gap-2 text-xs">Agent<select aria-label="Filter by agent" className="max-w-64 rounded-md border bg-background p-1.5" value={workspaceId} onChange={event => { setWorkspaceId(event.target.value); setTarget(''); }}><option value="">All agents</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
      <div className="flex gap-3 text-xs"><label><input type="radio" checked={!newChat} onChange={() => setNewChat(false)} /> Existing chat</label><label><input type="radio" checked={newChat} onChange={() => setNewChat(true)} /> New chat</label></div>
      {newChat ? <div className="space-y-2 rounded-lg border p-3"><p className="text-xs text-muted-foreground">{workspaceId ? 'Start a new chat in the selected agent.' : 'Choose an agent above for the new chat.'}</p><div className="flex flex-wrap gap-2"><ModelControl selection={{ harness, model }} label={selectedModel?.label ?? (model || 'Default model')} variant={variant} effort={effort} serviceTier={serviceTier} onChange={setSelection} onEffortChange={next => setSelection({ harness, model, variant, effort: next, serviceTier })} /></div></div>
        : <div className="max-h-56 overflow-y-auto rounded-lg border" aria-label="Chats by recent activity">{isLoading ? <p className="p-3 text-xs text-muted-foreground">Loading chats…</p> : chats.length === 0 ? <p className="p-3 text-xs text-muted-foreground">No matching chats.</p> : chats.map(chat => <button key={chat.id} type="button" aria-pressed={target === chat.id} onClick={() => setTarget(chat.id)} className={`block w-full border-b px-3 py-2 text-left last:border-0 ${target === chat.id ? 'bg-primary/10' : 'hover:bg-muted/50'}`}><span className="block truncate text-sm font-medium">{chat.label ?? (chat.type === 'orchestration' ? chat.workspaceId ? 'Agent main chat' : 'Orchestrator' : 'Untitled chat')}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{chat.agentName ?? 'Orchestrator'} · {new Date(chat.lastActivityAt ?? chat.updatedAt).toLocaleString()}</span></button>)}</div>}
      <label className="block space-y-1 text-xs"><span>Your directions, optional</span><textarea value={directions} onChange={event => setDirections(event.target.value)} rows={3} className="w-full rounded-md border bg-background p-2 text-sm" placeholder="For example, review this feedback against your current changes." /></label>
      <div className="flex justify-end gap-2"><button type="button" disabled={send.isPending} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground" onClick={onClose}>Cancel</button><button type="button" disabled={send.isPending || (newChat ? !workspaceId : !target)} onClick={() => send.mutate()} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">{send.isPending ? 'Sending…' : 'Send to chat'}</button></div>
    </div>
  </DialogContent></Dialog>;
}
