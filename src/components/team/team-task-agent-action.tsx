'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { useHomeContext } from '@/components/home/home-context';
import { useSpace } from '@/components/spaces/space-root';
import { StartWithAgentButton } from '@/components/tasks/start-with-agent-button';
import type { TaskLike } from '@/components/tasks/task-launcher-seed';
import { WorkWithPersonalAgent } from '@/components/spaces/work-with-personal-agent';
import { myRiClient } from '@/lib/spaces/my-ri-client';
import { trpc } from '@/lib/trpc/client';
import { isTerminal } from '@/lib/tasks/lifecycle';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tip } from '@/components/ui/tip';
import { useHomeExecutionChoices } from '@/hooks/use-home-execution-choices';

/** One entry, with a destination choice only when both Homes can actually run work. */
export function TeamTaskAgentAction({ task }: { task: TaskLike }) {
  const home = useHomeContext();
  const space = useSpace();
  const terminal = isTerminal(task.status);
  const team = useHomeExecutionChoices(home.capabilities.runTeamAgent && !terminal);
  const personal = useQuery({
    queryKey: trpc.spaces.personalExecutionChoices.queryKey(),
    queryFn: () => myRiClient.spaces.personalExecutionChoices.query(), enabled: !!space && space.status === 'active' && !terminal, retry: false, staleTime: 30_000,
  });
  const [open, setOpen] = useState(false);
  const teamReady = home.capabilities.runTeamAgent && team.data?.some(choice => choice.audience === 'team' && choice.available);
  const personalReady = !!space && personal.data?.some(choice => choice.audience === 'personal' && choice.available);
  if (terminal) return null;
  if (!teamReady && !personalReady) {
    if (team.error || personal.error) return <button type="button" className="text-xs text-muted-foreground underline" onClick={() => {
      if (team.error) void team.refetch();
      if (personal.error) void personal.refetch();
    }}>Retry agent availability</button>;
    if (team.isFetching || personal.isFetching) return <span role="status" className="text-xs text-muted-foreground">Checking agents…</span>;
    return null;
  }
  if (!teamReady) return <WorkWithPersonalAgent taskId={task.id} label="Work in My Ri" />;
  if (!personalReady) return <Tip label="Runs on this team's server. Everyone on the team can read the chat."><span><StartWithAgentButton task={task} label="Work on team's server" /></span></Tip>;
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild><button type="button" className="inline-flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-medium hover:bg-muted"><Bot size={13}/>Work with agent</button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="space-y-2 p-3">
      <div><StartWithAgentButton task={task} label="Work on team's server"/><p className="mt-1 text-[11px] text-muted-foreground">Everyone on the team can read the chat.</p></div>
      <div><WorkWithPersonalAgent taskId={task.id} label="Work in My Ri"/><p className="mt-1 text-[11px] text-muted-foreground">Your personal agents. Only you can read the chat.</p></div>
    </DropdownMenuContent>
  </DropdownMenu>;
}
