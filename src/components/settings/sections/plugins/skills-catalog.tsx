'use client';

/**
 * Skills in Plugins (docs/skills.md): the New skill button beside the tabs,
 * and the Skills tab, every skill grouped by where it lives, which is who
 * uses it: the drafts, Ri's own, the global ones, and each project's.
 */

import { useMemo, useState } from 'react';
import { Loader2, Plus, ScrollText, Search } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import type { SkillSummary } from '@/lib/api/skills';
import { useCreateSkill, useSkills } from '@/hooks/use-skills';
import { useDashboard } from '@/contexts/dashboard-context';
import { closeSettings } from '@/components/settings/settings-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LOCATION_GROUPS, displayPath } from '@/components/skills/location-copy';
import { cn } from '@/lib/utils';
import { CatalogTile, Chip, GroupHeading } from '../integrations/parts';

function SkillLogo() {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <ScrollText size={17} />
    </span>
  );
}

/**
 * New skill: starts a draft and opens it in the builder, chat on the left,
 * the file on the right. Nothing uses a draft until it's installed from
 * there. Clicking again before writing anything opens the same blank draft
 * rather than piling up empty ones.
 */
export function NewSkillButton({ className }: { className?: string }) {
  const create = useCreateSkill();
  const { openSkill } = useDashboard();
  return (
    <Button
      variant="outline"
      size="xs"
      className={cn('text-[11.5px]', className)}
      disabled={create.isPending}
      onClick={() =>
        create.mutate(
          {},
          {
            onSuccess: ({ skill }) => {
              closeSettings();
              openSkill(skill.ref);
            },
            onError: (err) => toast.error(apiErrorText(err)),
          },
        )
      }
    >
      {create.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
      New skill
    </Button>
  );
}

/** Skills matching the catalog search, and how many there are, for its empty state. */
export function useSkillsCatalog(q: string) {
  const { data, isLoading } = useSkills();
  return useMemo(() => {
    const matches = (s: SkillSummary) =>
      !q ||
      s.name.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q) ||
      (s.location.kind === 'project' && s.location.projectName.toLowerCase().includes(q));
    const skills = (data?.skills ?? []).filter(matches);
    return { skills, total: skills.length, isLoading };
  }, [data, q, isLoading]);
}

export function SkillTile({ skill, onOpen }: { skill: SkillSummary; onOpen: () => void }) {
  const chip = skill.linkedFrom ? 'Linked' : skill.uncommitted ? 'Not committed' : null;
  return (
    <CatalogTile
      logo={<SkillLogo />}
      name={skill.name}
      subtitle={
        <>
          {chip && (
            <span className="mr-1.5 inline-block align-[1px]">
              <Chip tone={skill.uncommitted ? 'warn' : 'neutral'}>{chip}</Chip>
            </span>
          )}
          {skill.description?.trim() || 'No description yet.'}
        </>
      }
      tone={skill.hasErrors ? 'warn' : undefined}
      toneLabel={skill.hasErrors ? 'Something in it needs fixing' : undefined}
      onOpen={onOpen}
    />
  );
}

interface Group {
  key: string;
  title: string;
  detail: string;
  skills: SkillSummary[];
}

/** Drafts first (they're waiting on you), then Ri, global, and each project by name. Empty groups are left out. */
function groupSkills(skills: SkillSummary[]): Group[] {
  const groups: Group[] = [
    { key: 'draft', ...LOCATION_GROUPS.draft, skills: skills.filter((s) => s.location.kind === 'draft') },
    { key: 'ri', ...LOCATION_GROUPS.ri, skills: skills.filter((s) => s.location.kind === 'ri') },
    { key: 'global', ...LOCATION_GROUPS.global, skills: skills.filter((s) => s.location.kind === 'global') },
  ];
  const projects = new Map<string, Group>();
  for (const skill of skills) {
    if (skill.location.kind !== 'project') continue;
    const { workspaceId, projectName, cwd } = skill.location;
    const group = projects.get(workspaceId) ?? {
      key: workspaceId,
      title: projectName,
      detail: `In ${displayPath(cwd)}. Agents working there use these, and so does anyone who pulls the repo.`,
      skills: [],
    };
    group.skills.push(skill);
    projects.set(workspaceId, group);
  }
  const byName = [...projects.values()].sort((a, b) => a.title.localeCompare(b.title));
  return [...groups, ...byName].filter((g) => g.skills.length > 0);
}

export function SkillsGroup({ skills, searching }: { skills: SkillSummary[]; searching: boolean }) {
  const { openSkill } = useDashboard();
  if (skills.length === 0) return null;
  return (
    <div className="space-y-5">
      {groupSkills(skills).map((group) => (
        <section key={group.key} className="space-y-2">
          <GroupHeading count={group.skills.length}>{group.title}</GroupHeading>
          {!searching && <p className="-mt-1 text-[11px] text-muted-foreground">{group.detail}</p>}
          <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">
            {group.skills.map((skill) => (
              <SkillTile
                key={skill.ref}
                skill={skill}
                onOpen={() => {
                  closeSettings();
                  openSkill(skill.ref);
                }}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * The Skills tab of Plugins: every skill grouped by where it lives. A search
 * box appears once there are enough to need one. New skills start from
 * NewSkillButton, beside the tabs.
 */
export function SkillsTab() {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const { skills, isLoading } = useSkillsCatalog(q);
  const { data } = useSkills();
  const all = data?.skills.length ?? 0;
  return (
    <div className="@container space-y-5">
      {all > 8 && (
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills"
            aria-label="Search skills"
            className="rounded-4xl pl-9 text-xs"
          />
        </div>
      )}
      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading skills…
        </div>
      ) : all === 0 ? (
        <p className="py-6 text-center text-[12px] text-muted-foreground">
          No skills yet. A skill teaches your agents one way of working, like how you review a pull request. Start
          one with New skill.
        </p>
      ) : skills.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-muted-foreground">No skills match “{query}”.</p>
      ) : (
        <SkillsGroup skills={skills} searching={!!q} />
      )}
    </div>
  );
}
