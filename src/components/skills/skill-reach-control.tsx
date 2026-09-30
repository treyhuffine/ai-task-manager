'use client';

import { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import type { SkillReach, SkillView } from '@/lib/api/skills';
import { useSetSkillReach } from '@/hooks/use-skills';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AgentIcon } from '@/components/agents/agent-icon';
import { cn } from '@/lib/utils';
import { REACH_OPTIONS } from './reach-copy';

const SHORT: Record<SkillReach['mode'], string> = {
  all: 'Every agent',
  everywhere: 'Everywhere',
  agents: 'Some agents',
  off: 'Off',
};

/**
 * Where a skill is used: the quiet control beside the header's main action.
 * Every agent is the standard case. This is where you deviate from it (only
 * some agents, also outside Ri, or off).
 */
export function SkillReachControl({ skill }: { skill: SkillView }) {
  const setReach = useSetSkillReach(skill.name);
  const [picking, setPicking] = useState(false);
  const blocked = skill.problems.some((p) => p.level === 'error');
  const options = REACH_OPTIONS.filter((o) => o.mode !== 'everywhere' || skill.canReachOutside);

  const apply = (reach: SkillReach) =>
    setReach.mutate(reach, { onError: (err) => toast.error(apiErrorText(err)) });

  const label =
    skill.reach.mode === 'agents'
      ? skill.reach.workspaceIds.length === 1
        ? '1 agent'
        : `${skill.reach.workspaceIds.length} agents`
      : SHORT[skill.reach.mode];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-7 flex-shrink-0 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground"
            aria-label={`Where this skill is used: ${label}`}
            title="Where this skill is used"
          >
            {setReach.isPending ? <Loader2 size={11} className="animate-spin" /> : null}
            {label}
            <ChevronDown size={11} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Who uses this skill
          </DropdownMenuLabel>
          {options.map((o) => {
            const current = skill.reach.mode === o.mode;
            const disabled = o.mode !== 'off' && blocked;
            return (
              <DropdownMenuItem
                key={o.mode}
                disabled={disabled}
                onSelect={() => (o.mode === 'agents' ? setPicking(true) : !current && apply({ mode: o.mode } as SkillReach))}
                className="flex flex-col items-start gap-0.5 py-1.5"
              >
                <span className={cn('text-[12px]', current ? 'font-semibold text-foreground' : 'text-foreground')}>
                  {o.label}
                  {current && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">current</span>}
                </span>
                <span className="text-[10.5px] text-muted-foreground">{o.detail}</span>
              </DropdownMenuItem>
            );
          })}
          {blocked && (
            <>
              <DropdownMenuSeparator />
              <p className="px-2 py-1.5 text-[10.5px] text-muted-foreground">Fix what&apos;s flagged in the editor to turn it on.</p>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {picking && (
        <AgentPicker
          skill={skill}
          onCancel={() => setPicking(false)}
          onSave={(ids) => {
            setPicking(false);
            apply({ mode: 'agents', workspaceIds: ids });
          }}
        />
      )}
    </>
  );
}

function AgentPicker({
  skill,
  onCancel,
  onSave,
}: {
  skill: SkillView;
  onCancel: () => void;
  onSave: (workspaceIds: string[]) => void;
}) {
  const { data: agents = [], isLoading } = useWorkspaces();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(skill.reach.mode === 'agents' ? skill.reach.workspaceIds : []),
  );
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Which agents use {skill.name}?</DialogTitle>
          <DialogDescription>
            Their main chats and executions get the skill. Everything else in Ri won&apos;t see it.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {isLoading ? (
            <Loader2 size={14} className="mx-auto my-4 animate-spin text-muted-foreground" />
          ) : agents.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-muted-foreground">You don&apos;t have any agents yet.</p>
          ) : (
            agents.map((agent) => (
              <label
                key={agent.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/50"
              >
                <Checkbox checked={selected.has(agent.id)} onCheckedChange={() => toggle(agent.id)} />
                <AgentIcon workspace={agent} size="sm" />
                <span className="truncate text-[12.5px] text-foreground">{agent.name}</span>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={selected.size === 0} onClick={() => onSave([...selected])}>
            Use with {selected.size === 1 ? '1 agent' : `${selected.size} agents`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
