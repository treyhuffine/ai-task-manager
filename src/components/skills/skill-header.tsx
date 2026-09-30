'use client';

import { useState } from 'react';
import { Archive, ChevronLeft, Copy, Loader2, MoreHorizontal, Pencil, Power, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import type { SkillView } from '@/lib/api/skills';
import { useArchiveSkill, useSaveSkill, useSetSkillReach } from '@/hooks/use-skills';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { useDashboard } from '@/contexts/dashboard-context';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { reachSentence } from './reach-copy';
import { SkillReachControl } from './skill-reach-control';

export type SkillPane = 'chat' | 'skill';

/** Home-relative display of an absolute path, the way a shell prompt shows it. */
function displayPath(path: string): string {
  const home = path.match(/^\/(?:Users|home)\/[^/]+/)?.[0];
  return home ? `~${path.slice(home.length)}` : path;
}

/**
 * The skill builder's header: the skill's name (its slash command), who
 * uses it, and the one action that matters while it's off, turning it on.
 * Where it's used and the rest live behind quieter controls.
 */
export function SkillHeader({
  skill,
  onBack,
  pane,
}: {
  skill: SkillView;
  onBack?: () => void;
  pane?: { value: SkillPane; onChange: (pane: SkillPane) => void };
}) {
  const { openSkill, goHome } = useDashboard();
  const confirm = useConfirm();
  const { data: agents = [] } = useWorkspaces();
  const setReach = useSetSkillReach(skill.name);
  const save = useSaveSkill(skill.name);
  const archive = useArchiveSkill();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(skill.name);

  const blocking = skill.problems.find((p) => p.level === 'error');
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name;

  const rename = () => {
    const next = newName.trim();
    setRenaming(false);
    if (!next || next === skill.name) return;
    save.mutate(
      { newName: next },
      {
        onSuccess: (result) => openSkill(result.skill.name, { replace: true }),
        onError: (err) => {
          setNewName(skill.name);
          toast.error(apiErrorText(err));
        },
      },
    );
  };

  const onArchive = async () => {
    const ok = await confirm({
      title: `Archive ${skill.name}?`,
      description:
        'No agent will use it anymore, and its chats are archived with it. The folder moves to the archive in your Ri home, so nothing is deleted.',
      confirmLabel: 'Archive',
      tone: 'destructive',
    });
    if (!ok) return;
    archive.mutate(skill.name, {
      onSuccess: () => {
        toast.success(`${skill.name} archived`);
        goHome();
      },
      onError: (err) => toast.error(apiErrorText(err)),
    });
  };

  return (
    <header className="@container flex-shrink-0 min-w-0 border-b border-border">
      <div className="flex min-w-0 items-center gap-3 px-4 py-2">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            className="-ml-2 rounded-md p-1.5 text-muted-foreground hover:text-foreground active:bg-muted/40"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <span className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ScrollText size={16} />
        </span>
        <div className="min-w-0">
          {renaming ? (
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') rename();
                if (e.key === 'Escape') {
                  setNewName(skill.name);
                  setRenaming(false);
                }
              }}
              aria-label="Skill name"
              className="w-56 rounded-md border border-ring bg-background px-1.5 py-0.5 font-mono text-[13px] font-semibold text-foreground outline-none"
            />
          ) : (
            <button
              onClick={() => {
                setNewName(skill.name);
                setRenaming(true);
              }}
              className="group flex min-w-0 items-center gap-1.5 text-left"
              title="Rename. The name is also its slash command."
            >
              <h1 className="truncate font-mono text-[13px] font-semibold text-foreground">{skill.name}</h1>
              {save.isPending ? (
                <Loader2 size={11} className="flex-shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Pencil size={11} className="flex-shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
              )}
            </button>
          )}
          <p className="truncate text-[10.5px] text-muted-foreground/80" title={displayPath(skill.dir)}>
            {reachSentence(skill.reach, agentName)}
          </p>
        </div>

        {skill.reach.mode === 'off' && (
          <button
            onClick={() =>
              setReach.mutate(
                { mode: 'all' },
                {
                  onSuccess: () => toast.success(`${skill.name} is on for every agent`),
                  onError: (err) => toast.error(apiErrorText(err)),
                },
              )
            }
            disabled={!!blocking || setReach.isPending}
            title={blocking ? `Fix this first: ${blocking.message}` : 'Every agent in Ri gets this skill'}
            className="flex h-7 flex-shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {setReach.isPending ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} strokeWidth={2.5} />}
            Turn on
          </button>
        )}

        <div className="flex-1" />

        <SkillReachControl skill={skill} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="More"
              className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <MoreHorizontal size={15} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setNewName(skill.name);
                setRenaming(true);
              }}
            >
              <Pencil size={13} /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void navigator.clipboard.writeText(skill.dir).then(() => toast.success('Folder path copied'));
              }}
            >
              <Copy size={13} /> Copy folder path
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void onArchive()} className="text-destructive focus:text-destructive">
              <Archive size={13} /> Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {pane && (
        <div role="tablist" aria-label="Chat or skill" className="flex gap-1 px-4 pb-2">
          {(['chat', 'skill'] as const).map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={pane.value === p}
              onClick={() => pane.onChange(p)}
              className={cn(
                'flex flex-1 items-center justify-center rounded-md py-1.5 text-[12px] font-medium transition-colors',
                pane.value === p ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground active:bg-muted/50',
              )}
            >
              {p === 'chat' ? 'Chat' : 'Skill'}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
