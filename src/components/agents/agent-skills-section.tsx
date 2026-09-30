'use client';

import { FolderOpen, Loader2, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import type { SkillReach, SkillSummary } from '@/lib/api/skills';
import { useSetSkillReach, useSkills } from '@/hooks/use-skills';
import { useDashboard } from '@/contexts/dashboard-context';
import { openSettings } from '@/components/settings/settings-store';
import { Switch } from '@/components/ui/switch';
import type { WorkspaceRecord } from '@/db/types';

/**
 * The skills this agent uses, in its main chat and executions
 * (docs/skills.md). Skills on for every agent are always here, so they're
 * listed without a switch. A skill limited to some agents, or still off,
 * gets a switch that adds or removes just this agent. Skills in the agent's
 * own folder (.ri/skills) always apply there.
 */
export function AgentSkillsSection({ workspace }: { workspace: WorkspaceRecord }) {
  const { data, isLoading } = useSkills(workspace.id);
  const skills = data?.skills ?? [];
  const folderSkills = data?.folderSkills ?? [];
  const everyAgent = skills.filter((s) => s.reach.mode === 'all' || s.reach.mode === 'everywhere');
  const choosable = skills.filter((s) => s.reach.mode === 'agents' || s.reach.mode === 'off');

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Skills</h3>
        <p className="text-[12px] leading-normal text-muted-foreground">
          How this agent does things, in its executions and its main chat. Build and edit skills in{' '}
          <button onClick={() => openSettings('connectors')} className="font-medium text-primary hover:underline">
            Plugins
          </button>
          .
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading skills…
        </div>
      ) : skills.length === 0 && folderSkills.length === 0 ? (
        <p className="text-[12px] text-muted-foreground/80">No skills yet.</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border">
          {choosable.map((skill) => (
            <ChoosableSkill key={skill.name} skill={skill} workspaceId={workspace.id} />
          ))}
          {everyAgent.map((skill) => (
            <SkillRow key={skill.name} name={skill.name} description={skill.description}>
              <span className="text-[11px] text-muted-foreground/80">Every agent</span>
            </SkillRow>
          ))}
          {folderSkills.map((skill) => (
            <SkillRow key={`folder:${skill.name}`} name={skill.name} description={skill.description} inFolder>
              <span className="text-[11px] text-muted-foreground/80">In this folder</span>
            </SkillRow>
          ))}
        </ul>
      )}
    </section>
  );
}

function SkillRow({
  name,
  description,
  inFolder = false,
  children,
}: {
  name: string;
  description: string | null;
  inFolder?: boolean;
  children: React.ReactNode;
}) {
  const { openSkill } = useDashboard();
  const label = (
    <>
      <p className="truncate font-mono text-[12px] font-medium text-foreground">{name}</p>
      <p className="line-clamp-1 text-[11px] text-muted-foreground">{description?.trim() || 'No description yet.'}</p>
    </>
  );
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      {inFolder ? (
        <FolderOpen size={14} className="shrink-0 text-muted-foreground" aria-label="In this agent's folder" />
      ) : (
        <ScrollText size={14} className="shrink-0 text-muted-foreground" />
      )}
      {inFolder ? (
        <div className="min-w-0 flex-1">{label}</div>
      ) : (
        <button onClick={() => openSkill(name)} className="min-w-0 flex-1 text-left hover:opacity-80" title="Open the skill">
          {label}
        </button>
      )}
      {children}
    </li>
  );
}

function ChoosableSkill({ skill, workspaceId }: { skill: SkillSummary; workspaceId: string }) {
  const setReach = useSetSkillReach(skill.name);
  const ids = skill.reach.mode === 'agents' ? skill.reach.workspaceIds : [];
  const on = ids.includes(workspaceId);
  const toggle = (next: boolean) => {
    const rest = ids.filter((id) => id !== workspaceId);
    const reach: SkillReach = next
      ? { mode: 'agents', workspaceIds: [...rest, workspaceId] }
      : rest.length > 0
        ? { mode: 'agents', workspaceIds: rest }
        : { mode: 'off' };
    setReach.mutate(reach, { onError: (err) => toast.error(apiErrorText(err)) });
  };
  const note = skill.reach.mode === 'off' ? 'Off' : on ? null : 'Other agents';
  return (
    <SkillRow name={skill.name} description={skill.description}>
      {note && <span className="text-[11px] text-muted-foreground/70">{note}</span>}
      {setReach.isPending && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
      <Switch
        checked={on}
        disabled={setReach.isPending || (!on && skill.hasErrors)}
        onCheckedChange={toggle}
        aria-label={on ? `Stop ${skill.name} for this agent` : `Use ${skill.name} with this agent`}
        title={!on && skill.hasErrors ? 'Fix it in the skill builder first' : undefined}
      />
    </SkillRow>
  );
}
