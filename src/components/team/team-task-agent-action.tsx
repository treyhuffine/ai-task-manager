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

/** One entry, with a destination choice only when both Homes can actually run work. */
export function TeamTaskAgentAction({ task }: { task: TaskLike }) {
  const home = useHomeContext();
  const space = useSpace();
  const personal = useQuery({
    queryKey: trpc.spaces.personalContext.queryKey(),
    queryFn: () => myRiClient.spaces.personalContext.query(), enabled: !!space && space.status === 'active', retry: false, staleTime: 30_000,
  });
  const [open, setOpen] = useState(false);
  const teamReady = home.capabilities.runTeamAgent && home.executionChoices.some(choice => choice.audience === 'team' && choice.available);
  const personalReady = !!space && personal.data?.home.kind === 'personal' && personal.data.executionChoices.some(choice => choice.available);
  if (isTerminal(task.status) || (!teamReady && !personalReady)) return null;
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
