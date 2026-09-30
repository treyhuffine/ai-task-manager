'use client';

/**
 * The skills half of the Plugins page (docs/skills.md): the "Build a skill"
 * box on top, then the home's skills as tiles, then skills found in
 * ~/.claude/skills and ~/.agents/skills that Ri doesn't own yet. Connectors
 * follow below, in connectors-section.tsx, which hosts this and shares its
 * search.
 */

import { useMemo, useState } from 'react';
import { AlertCircle, ArrowRightLeft, Loader2, Pencil, ScrollText } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import { sessionsApi } from '@/lib/api/sessions';
import { skillsApi, type OutsideSkill, type SkillSummary } from '@/lib/api/skills';
import { SKILLS_KEY, useImportSkill, useSkills } from '@/hooks/use-skills';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { useDashboard } from '@/contexts/dashboard-context';
import { closeSettings } from '@/components/settings/settings-store';
import { Button } from '@/components/ui/button';
import { ensureSkillChat, skillChatQueryKey } from '@/components/skills/use-skill-chat';
import { reachBadge } from '@/components/skills/reach-copy';
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
 * builder, off until you turn it on.
 */
export function SkillBuilderBox() {
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
      const { skill } = await skillsApi.create(how === 'ai' ? { intent } : { intent, description: intent || undefined });
      qc.setQueryData([...SKILLS_KEY, 'one', skill.name], skill);
      void qc.invalidateQueries({ queryKey: [...SKILLS_KEY, 'overview'] });
      if (how === 'ai') {
        const session = await ensureSkillChat(skill.name, 'build');
        qc.setQueryData(skillChatQueryKey(skill.name, 'build'), session);
        await sessionsApi.sendMessage(session.id, intent, { eventId: uuidv7() });
      }
      setText('');
      closeSettings();
      openSkill(skill.name);
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card/30 p-4">
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
    const matches = (s: { name: string; description: string | null }) =>
      !q || kindMatch || s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q);
    const skills = (data?.skills ?? []).filter(matches);
    const outside = (data?.outside ?? []).filter(matches);
    return { skills, outside, total: skills.length + outside.length, isLoading };
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

export function SkillsGroup({ skills, outside, searching }: { skills: SkillSummary[]; outside: OutsideSkill[]; searching: boolean }) {
  const { openSkill } = useDashboard();
  if (skills.length === 0 && outside.length === 0) return null;
  return (
    <div className="space-y-4">
      <KindHeading title="Skills" detail={searching ? undefined : 'How your agents do things. On for every agent unless marked.'} />
      {skills.length > 0 && (
        <section className="space-y-2">
          <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">
            {skills.map((skill) => {
              const badge = reachBadge(skill.reach);
              return (
                <CatalogTile
                  key={skill.name}
                  logo={<SkillLogo />}
                  name={skill.name}
                  subtitle={
                    <>
                      {badge && (
                        <span className="mr-1.5 inline-block align-[1px]">
                          <Chip tone={skill.reach.mode === 'off' ? 'off' : 'neutral'}>{badge}</Chip>
                        </span>
                      )}
                      {skill.description?.trim() || 'No description yet.'}
                    </>
                  }
                  tone={skill.hasErrors ? 'warn' : undefined}
                  toneLabel={skill.hasErrors ? 'Needs fixing before agents can use it' : undefined}
                  onOpen={() => {
                    closeSettings();
                    openSkill(skill.name);
                  }}
                />
              );
            })}
          </div>
        </section>
      )}
      {outside.length > 0 && <OutsideSkillsGroup outside={outside} searching={searching} />}
    </div>
  );
}

/**
 * Skills in the user-level folders that Ri doesn't own. Your harnesses
 * already use them outside Ri (and Claude inside it). Moving one in makes
 * the Ri copy the one copy, linked back where it was.
 */
function OutsideSkillsGroup({ outside, searching }: { outside: OutsideSkill[]; searching: boolean }) {
  const importSkill = useImportSkill();
  const { openSkill } = useDashboard();
  const [pending, setPending] = useState<string | null>(null);
  return (
    <section className="space-y-2">
      <GroupHeading count={outside.length}>On this computer, outside Ri</GroupHeading>
      {!searching && (
        <p className="text-[11px] text-muted-foreground">
          Found in ~/.claude/skills or ~/.agents/skills. Move one into Ri to edit it here. It stays linked where it
          was, so your other tools keep using it.
        </p>
      )}
      <ul className="divide-y divide-border/60 rounded-xl border border-border">
        {outside.map((skill) => (
          <li key={skill.name} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[12px] font-medium text-foreground">{skill.name}</p>
              <p className="line-clamp-1 text-[11px] text-muted-foreground">
                {skill.description?.trim() || 'No description.'}
              </p>
            </div>
            {skill.importBlocker ? (
              <span className="max-w-[45%] text-right text-[10.5px] text-muted-foreground/80">{skill.importBlocker}</span>
            ) : (
              <Button
                variant="outline"
                size="xs"
                className="shrink-0 text-xs"
                disabled={pending !== null}
                onClick={() => {
                  setPending(skill.name);
                  importSkill.mutate(skill.name, {
                    onSuccess: ({ skill: moved }) => {
                      toast.success(`${moved.name} is in Ri now`);
                      closeSettings();
                      openSkill(moved.name);
                    },
                    onError: (err) => toast.error(apiErrorText(err)),
                    onSettled: () => setPending(null),
                  });
                }}
              >
                {pending === skill.name ? <Loader2 size={12} className="animate-spin" /> : <ArrowRightLeft size={12} />}
                Move into Ri
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
