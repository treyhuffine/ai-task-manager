'use client';

/**
 * The Skills tab of Plugins (docs/skills.md): a one-line composer to start a
 * new skill, then every skill grouped by where it lives, which is who uses
 * it: Ri's own, the global ones, and each project's.
 */

import { useMemo, useState } from 'react';
import { AlertCircle, Loader2, Pencil, ScrollText, Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { apiErrorText } from '@/lib/api/client';
import { sessionsApi } from '@/lib/api/sessions';
import { skillsApi, type CreateSkillBody, type SkillSummary } from '@/lib/api/skills';
import { SKILLS_KEY, skillKey, useSkills } from '@/hooks/use-skills';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { useDashboard } from '@/contexts/dashboard-context';
import { closeSettings } from '@/components/settings/settings-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ensureSkillChat, skillChatQueryKey } from '@/components/skills/use-skill-chat';
import { LOCATION_GROUPS, displayPath } from '@/components/skills/location-copy';
import { CatalogTile, Chip, GroupHeading } from '../connectors/parts';

function SkillLogo() {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <ScrollText size={17} />
    </span>
  );
}

/**
 * Where building a skill starts: one line. Say what it should do, then draft
 * it with AI (Enter: the text becomes the builder chat's first message) or
 * write it yourself (the text becomes the first description). Either way it
 * opens in the builder. It goes in Ri unless `location` says a project, as it
 * does from an agent's Setup tab.
 */
export function NewSkillComposer({ location }: { location?: Pick<CreateSkillBody, 'location' | 'workspaceId'> }) {
  const qc = useQueryClient();
  const { openSkill } = useDashboard();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'ai' | 'hand' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intent = text.trim();

  const start = async (how: 'ai' | 'hand') => {
    if (busy || (how === 'ai' && !intent)) return;
    setBusy(how);
    setError(null);
    try {
      const { skill } = await skillsApi.create({
        ...location,
        intent,
        ...(how === 'hand' && intent ? { description: intent } : {}),
      });
      qc.setQueryData(skillKey(skill.ref), skill);
      void qc.invalidateQueries({ queryKey: [...SKILLS_KEY, 'overview'] });
      if (how === 'ai') {
        const session = await ensureSkillChat(skill.ref, 'build');
        qc.setQueryData(skillChatQueryKey(skill.ref, 'build'), session);
        await sessionsApi.sendMessage(session.id, intent, { eventId: uuidv7() });
      }
      setText('');
      closeSettings();
      openSkill(skill.ref);
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2 rounded-xl border border-border bg-card/20 py-1 pl-3 pr-1 transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
        <ScrollText size={14} className="mt-[7px] shrink-0 text-muted-foreground" />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (matchesHotkey(e.nativeEvent, HOTKEYS.submitCapture) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void start('ai');
            }
          }}
          rows={1}
          aria-label="Describe a new skill"
          placeholder="New skill: what should it do?"
          className="field-sizing-content max-h-32 min-h-7 flex-1 resize-none bg-transparent py-1 text-[12.5px] leading-5 text-foreground outline-none placeholder:text-muted-foreground/60"
        />
        <Button
          variant="ghost"
          size="xs"
          className="shrink-0 text-[11px] text-muted-foreground"
          disabled={!!busy}
          onClick={() => void start('hand')}
          title="Start a blank skill and write it yourself"
        >
          {busy === 'hand' ? <Loader2 size={11} className="animate-spin" /> : <Pencil size={11} />}
          Write it
        </Button>
        <Button size="xs" className="shrink-0 text-[11px]" disabled={!!busy || !intent} onClick={() => void start('ai')}>
          {busy === 'ai' && <Loader2 size={11} className="animate-spin" />}
          Draft with AI
        </Button>
      </div>
      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-destructive">
          <AlertCircle size={12} className="mt-px shrink-0" />
          {error}
        </p>
      )}
    </div>
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

/** Ri first, then global, then each project by name. Empty groups are left out. */
function groupSkills(skills: SkillSummary[]): Group[] {
  const groups: Group[] = [
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
 * The Skills tab of Plugins: start a new skill, then every skill grouped by
 * where it lives. A search box appears once there are enough to need one.
 */
export function SkillsTab() {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const { skills, isLoading } = useSkillsCatalog(q);
  const { data } = useSkills();
  const all = data?.skills.length ?? 0;
  return (
    <div className="@container space-y-5">
      <NewSkillComposer />
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
          No skills yet. A skill teaches your agents one way of working, like how you review a pull request.
        </p>
      ) : skills.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-muted-foreground">No skills match “{query}”.</p>
      ) : (
        <SkillsGroup skills={skills} searching={!!q} />
      )}
    </div>
  );
}
