'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { sessionKey } from '@/lib/query/session-keys';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { WorkspacePicker } from '@/components/workspaces/workspace-picker';
import { apiErrorText } from '@/lib/api/client';
import { useTeamNav } from './team-context';

export function useTeamAiStatus() {
  return useQuery({ ...trpc.team.ai.status.queryOptions(), staleTime: 15_000 });
}

/** No second transcript or composer. Existing unbound history uses the ordinary chat view. */
export function LegacyTeamChatAgentChoice({ chatId }: { chatId: string }) {
  const agents = useWorkspaces({ status: 'active' });
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const bind = useMutation({
    mutationFn: (workspaceId: string) => trpcClient.team.ai.chats.bind.mutate({ chatId, workspaceId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: sessionKey(chatId) }); void qc.invalidateQueries({ queryKey: trpc.team.ai.chats.list.queryKey() }); },
    onError: (error: unknown) => toast.error(apiErrorText(error)),
  });
  if (!agents.data) return null;
  return <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
    {agents.data.length === 0 ? "The owner needs to configure a team agent before this conversation can continue. Its history is kept."
      : agents.data.length === 1 ? `The next message continues with ${agents.data[0].name} on this team's server.`
        : <><span>Choose an agent to continue this conversation.</span><WorkspacePicker workspaces={agents.data} workspaceId={null} open={open && !bind.isPending} onOpenChange={setOpen} onChange={id => bind.mutate(id)} /></>}
  </div>;
}

export function TeamChat() {
  const nav = useTeamNav();
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
    <p>Start a shared chat from one of the team&apos;s agents.</p>
    <button className="rounded-md border border-border px-3 py-2 text-foreground hover:bg-muted/50" onClick={() => nav.show('agents')}>Open agents</button>
  </div>;
}
