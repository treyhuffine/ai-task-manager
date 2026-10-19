'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDashboard } from '@/contexts/dashboard-context';
import { mainChatKey } from '@/hooks/use-main-chat';
import { trpcClient } from '@/lib/trpc/client';
import { offerSourceToChat } from '@/lib/client/source-handoff';
import { SOURCE_STATUS_LABELS } from '@/lib/chat-sources/types';
import type { LibraryItem } from './library-model';

export function LibraryChat({ item, onClose }: { item: LibraryItem | null; onClose: () => void }) {
  return <Dialog open={!!item} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Use {item?.name} in chat</DialogTitle><DialogDescription>Choose what to reference. Your message stays a draft until you send it.</DialogDescription></DialogHeader>
      {item && <SourceChoices key={item.key} item={item} onClose={onClose} />}
    </DialogContent>
  </Dialog>;
}

function SourceChoices({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const dashboard = useDashboard();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const sources = useQuery({
    queryKey: ['apps-library-chat', item.key], staleTime: 0,
    queryFn: async () => {
      const [main, toolkits] = await Promise.all([
        queryClient.fetchQuery({ queryKey: mainChatKey(null), queryFn: () => trpcClient.orchestratorChat.list.query({}), staleTime: 0 }),
        trpcClient.integrations.toolkitsGet.query({}),
      ]);
      let providerId = item.target.kind === 'provider' ? item.target.id : undefined;
      if (item.target.kind === 'mcp') {
        const { servers } = await trpcClient.integrations.mcpServersGet.query({});
        const id = item.target.id;
        const server = servers.find(server => server.id === id);
        if (server) providerId = `mcp_${server.slug.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      }
      const groups = toolkits.toolkits.filter(toolkit => toolkit.providerId === providerId);
      const results = await Promise.all(groups.map(group => trpcClient.chatSources.search.query({ chatId: main.session.id, query: '', filter: 'connector', groupId: group.id })));
      return { chatId: main.session.id, items: results.flatMap(result => result.items.flatMap(entry => entry.kind === 'source' ? [entry.source] : [])).filter(source => !item.sourceRef || source.sourceRef === item.sourceRef) };
    },
  });
  const open = (sourceRef?: string) => {
    if (!sources.data) return;
    try {
      if (sourceRef) offerSourceToChat(sources.data.chatId, sourceRef);
      onClose(); dashboard.goHome(); dashboard.showPanelTab('chat'); dashboard.setMobileTab('chat');
      if (dashboard.isFocusMode) dashboard.exitFocusMode();
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Could not prepare the reference.'); }
  };
  if (sources.isPending) return <p role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />Finding available accounts…</p>;
  if (sources.error) return <div role="alert" className="space-y-3 text-sm"><p>{sources.error.message}</p><Button variant="outline" onClick={() => void sources.refetch()}>Retry</Button></div>;
  return <div className="space-y-3">
    {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
    {!sources.data?.items.length ? <p className="text-sm text-muted-foreground">No accounts from this connection are available to reference. Check the connection and its access, then try again.</p>
      : sources.data.items.map(source => <button key={source.sourceRef} type="button" disabled={source.status === 'unavailable'} onClick={() => open(source.sourceRef)}
        className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50">
        <MessageCircle size={15} className="shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{source.label}</span><span className="text-xs text-muted-foreground">{SOURCE_STATUS_LABELS[source.status]}</span></span>
      </button>)}
    {sources.data?.items.some(source => source.status === 'unavailable') && <p className="text-xs text-muted-foreground">Some sources are unavailable with this chat’s engine or access. You can choose a supported engine in chat.</p>}
    {sources.data && !sources.data.items.some(source => source.status !== 'unavailable') && <Button variant="outline" onClick={() => open()}>Open chat</Button>}
  </div>;
}
