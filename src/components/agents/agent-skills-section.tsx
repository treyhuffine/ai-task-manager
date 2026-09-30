'use client';

import { Loader2 } from 'lucide-react';
import { useSkills } from '@/hooks/use-skills';
import { useDashboard } from '@/contexts/dashboard-context';
import { openSettings } from '@/components/settings/settings-store';
import { NewSkillComposer, SkillTile } from '@/components/settings/sections/plugins/skills-catalog';
import type { WorkspaceRecord } from '@/db/types';

/**
 * This agent's own skills: the project skills in its folder
 * (.claude/skills), which its chats and executions use and which the repo
 * shares with anyone who pulls it (docs/skills.md). It also gets every Ri
 * skill and every global skill, said in one line rather than listed.
 */
export function AgentSkillsSection({ workspace }: { workspace: WorkspaceRecord }) {
  const { data, isLoading } = useSkills();
  const { openSkill } = useDashboard();
  const skills = (data?.skills ?? []).filter(
    (s) => s.location.kind === 'project' && s.location.workspaceId === workspace.id,
  );
  const onThisComputer = (data?.projects ?? []).some((p) => p.workspaceId === workspace.id);
  const shared = (data?.skills ?? []).filter((s) => s.location.kind === 'ri' || s.location.kind === 'global').length;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Skills</h3>
        <p className="text-[12px] leading-normal text-muted-foreground">
          Skills in this project&apos;s folder. Its chats and executions use them, and anyone who pulls the repo gets
          them once they&apos;re committed. It also uses {shared === 1 ? 'your 1 Ri and global skill' : `your ${shared} Ri and global skills`}
          {' '}(see{' '}
          <button onClick={() => openSettings('plugins', { anchor: 'skills' })} className="font-medium text-primary hover:underline">
            Plugins
          </button>
          ).
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading skills…
        </div>
      ) : (
        <>
          {skills.length > 0 && (
            <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">
              {skills.map((skill) => (
                <SkillTile key={skill.ref} skill={skill} onOpen={() => openSkill(skill.ref)} />
              ))}
            </div>
          )}
          {onThisComputer ? (
            <NewSkillComposer location={{ location: 'project', workspaceId: workspace.id }} />
          ) : (
            <p className="text-[12px] text-muted-foreground/80">
              This agent&apos;s folder isn&apos;t on this computer, so its skills are managed where it lives.
            </p>
          )}
        </>
      )}
    </section>
  );
}
