'use client';

import { useQuery } from '@tanstack/react-query';
import { useOptionalHomeContext } from '@/components/home/home-context';
import { trpc } from '@/lib/trpc/client';

/** Shared folder activity has a human author even when no chat exists. */
export function AgentFolderActivity({ workspaceId }: { workspaceId: string }) {
  const home = useOptionalHomeContext();
  const enabled = home?.home.kind === 'team';
  const activity = useQuery({ ...trpc.team.agentActivity.queryOptions({ workspaceId }), enabled, staleTime: 5_000 });
  if (!enabled) return null;
  return <details className="shrink-0 border-b px-3 py-2 text-xs" onToggle={event => { if (event.currentTarget.open) void activity.refetch(); }}>
    <summary className="cursor-pointer text-muted-foreground">Recent shared folder activity</summary>
    <div className="max-h-36 overflow-y-auto pt-2">
      {activity.error ? <p>Activity could not be read. <button className="underline" onClick={() => void activity.refetch()}>Retry</button></p>
        : !activity.data?.length ? <p className="text-muted-foreground">No recorded file changes or terminals yet.</p>
          : <ol className="space-y-1">{activity.data.map(item => <li key={item.id}><span className="font-medium">{item.memberName}</span> · {item.kind === 'terminal_open' ? 'opened a terminal' : `${item.operation} ${item.resource}`} · <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></li>)}</ol>}
    </div>
  </details>;
}
