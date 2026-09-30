'use client';

import { useState } from 'react';
import { ChevronDown, FolderGit2, Globe, Loader2, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import type { MoveSkillBody, ProjectInfo, SkillView } from '@/lib/api/skills';
import { useMoveSkill, useSkills } from '@/hooks/use-skills';
import { useDashboard } from '@/contexts/dashboard-context';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';
import { displayPath, locationLabel } from './location-copy';

/**
 * Where a skill lives, which is who uses it: Ri, global, or a project. Moving
 * changes that. Adding to a project copies the skill into that repo, which
 * is how it's shared with the project's team, and leaves this one where it is.
 */
export function SkillLocationControl({ skill }: { skill: SkillView }) {
  const move = useMoveSkill(skill.ref);
  const { openSkill } = useDashboard();
  const [picking, setPicking] = useState(false);
  const here = skill.location.kind;

  const go = (body: MoveSkillBody, done: string) =>
    move.mutate(body, {
      onSuccess: ({ skill: moved }) => {
        if (body.copy) {
          toast.success(done, { action: { label: 'Open', onClick: () => openSkill(moved.ref) } });
        } else {
          toast.success(done);
          openSkill(moved.ref, { replace: true });
        }
      },
      onError: (err) => toast.error(apiErrorText(err)),
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-7 flex-shrink-0 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground"
            aria-label={`Where this skill lives: ${locationLabel(skill.location)}`}
            title="Where this skill lives"
          >
            {move.isPending && <Loader2 size={11} className="animate-spin" />}
            {locationLabel(skill.location)}
            <ChevronDown size={11} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {skill.editable ? 'Move it' : 'Copy it'}
          </DropdownMenuLabel>
          {here !== 'ri' && (
            <Item
              icon={<ScrollText size={13} />}
              label={skill.editable ? 'Move to Ri' : 'Copy into Ri'}
              detail="Every chat Ri runs uses it."
              onSelect={() => go({ to: 'ri', copy: !skill.editable }, skill.editable ? `${skill.name} is a Ri skill now` : `Copied ${skill.name} into Ri`)}
            />
          )}
          {here !== 'global' && skill.editable && skill.canWriteGlobal && (
            <Item
              icon={<Globe size={13} />}
              label="Move to global"
              detail="Every agent on this computer, in Ri and outside it."
              onSelect={() => go({ to: 'global' }, `${skill.name} is global now`)}
            />
          )}
          <DropdownMenuSeparator />
          <Item
            icon={<FolderGit2 size={13} />}
            label="Add to a project…"
            detail="Copy it into an agent's repo to share it with the team."
            onSelect={() => setPicking(true)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {picking && (
        <ProjectPicker
          skill={skill}
          onCancel={() => setPicking(false)}
          onPick={(project) => {
            setPicking(false);
            go({ to: 'project', workspaceId: project.workspaceId, copy: true }, `Added ${skill.name} to ${project.name}`);
          }}
        />
      )}
    </>
  );
}

function Item({ icon, label, detail, onSelect }: { icon: React.ReactNode; label: string; detail: string; onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="items-start gap-2 py-1.5">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[12px] text-foreground">{label}</span>
        <span className="text-[10.5px] text-muted-foreground">{detail}</span>
      </span>
    </DropdownMenuItem>
  );
}

function ProjectPicker({ skill, onCancel, onPick }: { skill: SkillView; onCancel: () => void; onPick: (project: ProjectInfo) => void }) {
  const { data, isLoading } = useSkills();
  const current = skill.location.kind === 'project' ? skill.location.workspaceId : null;
  const projects = (data?.projects ?? []).filter((p) => p.workspaceId !== current);
  const [selected, setSelected] = useState<string | null>(null);
  const project = projects.find((p) => p.workspaceId === selected) ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {skill.name} to a project</DialogTitle>
          <DialogDescription>
            A copy goes in the repo&apos;s .claude/skills. Agents working there use it, and your team gets it once
            it&apos;s committed. This one stays where it is.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {isLoading ? (
            <Loader2 size={14} className="mx-auto my-4 animate-spin text-muted-foreground" />
          ) : projects.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-muted-foreground">No agent has a folder on this computer yet.</p>
          ) : (
            projects.map((p) => (
              <button
                key={p.workspaceId}
                onClick={() => setSelected(p.workspaceId)}
                className={cn(
                  'flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left transition-colors',
                  selected === p.workspaceId ? 'bg-secondary' : 'hover:bg-muted/50',
                )}
              >
                <span className="text-[12.5px] text-foreground">{p.name}</span>
                <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                  {displayPath(p.cwd)}
                  {!p.isGit && ' · not a git repo'}
                </span>
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!project} onClick={() => project && onPick(project)}>
            {project ? `Add to ${project.name}` : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
