'use client';

/**
 * The skills half of the Plugins page (docs/skills.md): the "Build a skill"
 * box on top, then every skill grouped by where it lives, which is who uses
 * it: Ri's own, the global ones, and each project's. Connectors follow
 * below, in connectors-section.tsx, which hosts this and shares its search.
 */

import { useMemo, useState } from 'react';
import { AlertCircle, Loader2, Pencil, ScrollText } from 'lucide-react';
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
import { ensureSkillChat, skillChatQueryKey } from '@/components/skills/use-skill-chat';
import { LOCATION_GROUPS, displayPath } from '@/components/skills/location-copy';
import { cn } from '@/lib/utils';
import { CatalogTile, Chip, GroupHeading } from '../connectors/parts';

function SkillLogo() {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <ScrollText size={17} />
    </span>
  );
}

/**
 * Where building a skill starts. Say what it should do and draft it with AI
 * (the text becomes the builder chat's first message), or write it yourself
 * (the text becomes the first description). Either way it opens in the
 * builder. It goes in Ri unless `location` says a project, as it does from
 * an agent's Setup tab.
 */
export function SkillBuilderBox({
  location,
  compact = false,
}: {
  location?: Pick<CreateSkillBody, 'location' | 'workspaceId'>;
  /** Without the heading, for places that already say what this is. */
  compact?: boolean;
}) {
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
    <section className={cn('space-y-3', !compact && 'rounded-2xl border border-border bg-card/30 p-4')}>
      {!compact && (
        <div className="flex items-start gap-3">
          <SkillLogo />
          <div className="min-w-0 space-y-0.5">
            <h3 className="text-[13px] font-semibold text-foreground">Build a skill</h3>
            <p className="text-[11.5px] leading-snug text-muted-foreground">
              Teach your agents one way of working, like how you review a pull request or triage your inbox. Draft it
              with AI, write it yourself, or both.
            </p>
          </div>
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (matchesHotkey(e.nativeEvent, HOTKEYS.submitCapture) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void start('ai');
          }
        }}
        rows={2}
        aria-label="What should the skill do?"
        placeholder="What should it do? Like: triage my inbox each morning and draft replies to anything urgent"
        className="field-sizing-content max-h-40 min-h-[3.25rem] w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[12.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-[3px] focus:ring-ring/30"
      />
      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-destructive">
          <AlertCircle size={12} className="mt-px shrink-0" />
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" className="text-xs" disabled={!!busy} onClick={() => void start('hand')}>
          {busy === 'hand' ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={12} />}
          Write it yourself
        </Button>
        <Button size="sm" className="text-xs" disabled={!!busy || !intent} onClick={() => void start('ai')}>
          {busy === 'ai' && <Loader2 size={12} className="animate-spin" />}
          Draft with AI
          <kbd className="ml-1 rounded bg-primary-foreground/15 px-1 font-mono text-[9px]">{HOTKEYS.submitCapture.label}</kbd>
        </Button>
      </div>
    </section>
  );
}

/** Skills matching the catalog search, and how many there are, for its empty state. */
export function useSkillsCatalog(q: string) {
  const { data, isLoading } = useSkills();
  return useMemo(() => {
    // Searching "ski" or "skills" lists them all, the way a category search does for connectors.
    const kindMatch = q.length >= 3 && 'skills'.startsWith(q);
    const matches = (s: SkillSummary) =>
      !q ||
      kindMatch ||
      s.name.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q) ||
      (s.location.kind === 'project' && s.location.projectName.toLowerCase().includes(q));
    const skills = (data?.skills ?? []).filter(matches);
    return { skills, total: skills.length, isLoading };
  }, [data, q, isLoading]);
}

/** A kind of plugin (Skills, Connectors): one level above the tile groups. */
export function KindHeading({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="space-y-0.5 border-b border-border/60 pb-1.5">
      <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
      {detail && <p className="text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  );
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
    <div className="space-y-4">
      <KindHeading
        title="Skills"
        detail={searching ? undefined : 'How your agents do things. Where a skill lives is who uses it.'}
      />
      {groupSkills(skills).map((group) => (
        <section key={group.key} className="space-y-2">
          <GroupHeading count={group.skills.length}>{group.title}</GroupHeading>
          {!searching && <p className="text-[11px] text-muted-foreground">{group.detail}</p>}
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
