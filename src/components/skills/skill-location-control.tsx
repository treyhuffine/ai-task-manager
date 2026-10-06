'use client';

import { AlertCircle, Check, ChevronDown, Copy, FileClock, FolderGit2, Globe, Loader2, ScrollText, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import type { MoveSkillBody, ProjectInfo, SkillView } from '@/lib/api/skills';
import { useMoveSkill, useSkills } from '@/hooks/use-skills';
import { useDashboard } from '@/contexts/dashboard-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { WHO_USES, displayPath, locationLabel } from './location-copy';
import { Tip } from '@/components/ui/tip';

/**
 * Where a skill is installed, which is who uses it, as one menu. A draft
 * isn't installed anywhere, so the control is an Install button. Once it's
 * installed, the control names the place and the same menu moves it
 * (Ri, global, a project), copies it into a project to share it with that
 * repo's team, or uninstalls it back to a draft. Installing needs a skill
 * with nothing flagged as an error, the same rule the server keeps.
 */
export function SkillLocationControl({ skill }: { skill: SkillView }) {
  const move = useMoveSkill(skill.ref);
  const { data } = useSkills();
  const { openSkill } = useDashboard();
  const here = skill.location;
  const draft = here.kind === 'draft';
  const currentProject = here.kind === 'project' ? here.workspaceId : null;
  const projects = (data?.projects ?? []).filter((p) => p.workspaceId !== currentProject);
  const blocked = skill.hasErrors;

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

  const install = (to: 'ri' | 'global') =>
    go({ to }, draft ? `Installed ${skill.name} ${to === 'ri' ? 'in Ri' : 'globally'}` : `${skill.name} is ${to === 'ri' ? 'a Ri skill' : 'global'} now`);
  const installIn = (project: ProjectInfo) =>
    go({ to: 'project', workspaceId: project.workspaceId }, `${draft ? 'Installed' : 'Moved'} ${skill.name} in ${project.name}`);

  const trigger = draft ? (
    <Tip label="A draft. No agent uses it until it's installed.">
      <button
        className="flex h-7 flex-shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        {move.isPending && <Loader2 size={11} className="animate-spin" />}
        Install
        <ChevronDown size={11} strokeWidth={2.5} />
      </button>
    </Tip>
  ) : (
    <Tip label={`Installed in ${locationLabel(here)}: ${displayPath(skill.dir)}`}>
      <button
        className="flex h-7 max-w-48 flex-shrink-0 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground"
        aria-label={`Installed in ${locationLabel(here)}`}
      >
        {move.isPending ? <Loader2 size={11} className="animate-spin" /> : <PlaceIcon kind={here.kind} />}
        <span className="truncate">{locationLabel(here)}</span>
        <ChevronDown size={11} />
      </button>
    </Tip>
  );

  // Another tool's skill, linked into the global folder: copy it in to change it.
  if (!skill.editable) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <MenuLabel>Copy it</MenuLabel>
          <PlaceItem kind="ri" label="Copy into Ri" detail={WHO_USES.ri} onSelect={() => go({ to: 'ri', copy: true }, `Copied ${skill.name} into Ri`)} />
          <ProjectsSub
            label="Copy to a project"
            projects={projects}
            onPick={(p) => go({ to: 'project', workspaceId: p.workspaceId, copy: true }, `Copied ${skill.name} to ${p.name}`)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <MenuLabel>{draft ? 'Install it in' : 'Installed in'}</MenuLabel>
        {blocked && (
          <p className="flex items-start gap-1.5 px-2 pb-1.5 text-[10.5px] leading-snug text-amber-600 dark:text-amber-400">
            <AlertCircle size={12} className="mt-px flex-shrink-0" />
            Fix what the editor flags first. Agents would load it as it is.
          </p>
        )}
        <PlaceItem kind="ri" label="Ri" detail={WHO_USES.ri} current={here.kind === 'ri'} disabled={blocked} onSelect={() => install('ri')} />
        {(skill.canWriteGlobal || here.kind === 'global') && (
          <PlaceItem
            kind="global"
            label="Global"
            detail={WHO_USES.global}
            current={here.kind === 'global'}
            disabled={blocked}
            onSelect={() => install('global')}
          />
        )}
        <ProjectsSub
          label={here.kind === 'project' ? here.projectName : 'A project'}
          detail={here.kind === 'project' ? 'Move it to another project' : WHO_USES.project}
          current={here.kind === 'project'}
          disabled={blocked}
          projects={projects}
          onPick={installIn}
        />
        {!draft && (
          <>
            <DropdownMenuSeparator />
            <ProjectsSub
              icon={<Copy size={13} />}
              label="Copy to a project"
              detail="Share it with a repo's team and keep this one."
              disabled={blocked}
              projects={projects}
              onPick={(p) =>
                go({ to: 'project', workspaceId: p.workspaceId, copy: true }, `Added a copy of ${skill.name} to ${p.name}`)
              }
            />
            <PlaceItem
              icon={<Undo2 size={13} />}
              label="Uninstall"
              detail="Back to a draft. No agent uses it."
              onSelect={() => go({ to: 'draft' }, `Uninstalled ${skill.name}. It's a draft again.`)}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PlaceIcon({ kind }: { kind: SkillView['location']['kind'] }) {
  switch (kind) {
    case 'draft':
      return <FileClock size={13} />;
    case 'ri':
      return <ScrollText size={13} />;
    case 'global':
      return <Globe size={13} />;
    case 'project':
      return <FolderGit2 size={13} />;
  }
}

function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</DropdownMenuLabel>
  );
}

function ItemText({ label, detail }: { label: string; detail?: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="truncate text-[12px] text-foreground">{label}</span>
      {detail && <span className="text-[10.5px] text-muted-foreground">{detail}</span>}
    </span>
  );
}

function PlaceItem({
  kind,
  icon,
  label,
  detail,
  current = false,
  disabled = false,
  onSelect,
}: {
  kind?: SkillView['location']['kind'];
  icon?: React.ReactNode;
  label: string;
  detail: string;
  current?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        if (current) return e.preventDefault();
        onSelect();
      }}
      disabled={disabled && !current}
      aria-current={current || undefined}
      className="items-start gap-2 py-1.5"
    >
      <span className="mt-0.5 text-muted-foreground">{icon ?? (kind && <PlaceIcon kind={kind} />)}</span>
      <ItemText label={label} detail={detail} />
      {current && <Check size={13} className="mt-0.5 flex-shrink-0 text-primary" />}
    </DropdownMenuItem>
  );
}

/** A submenu of the projects a skill can go in: agents whose folder is on this computer. */
function ProjectsSub({
  icon,
  label,
  detail,
  current = false,
  disabled = false,
  projects,
  onPick,
}: {
  icon?: React.ReactNode;
  label: string;
  detail?: string;
  current?: boolean;
  disabled?: boolean;
  projects: ProjectInfo[];
  onPick: (project: ProjectInfo) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled} className={cn('items-start gap-2 py-1.5', disabled && 'opacity-50')}>
        <span className="mt-0.5 text-muted-foreground">{icon ?? <FolderGit2 size={13} />}</span>
        <ItemText label={label} detail={detail} />
        {current && <Check size={13} className="mt-0.5 flex-shrink-0 text-primary" />}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-64 overflow-y-auto">
        {projects.length === 0 ? (
          <DropdownMenuItem disabled className="text-[11px]">
            {current ? 'No other agent has a folder on this computer.' : 'No agent has a folder on this computer yet.'}
          </DropdownMenuItem>
        ) : (
          projects.map((p) => (
            <DropdownMenuItem key={p.workspaceId} onSelect={() => onPick(p)} className="items-start py-1.5">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[12px] text-foreground">{p.name}</span>
                <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                  {displayPath(p.cwd)}
                  {!p.isGit && ' · not a git repo'}
                </span>
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
