'use client';

import { useAreas, useCreateArea } from '@/hooks/use-areas';
import { apiErrorText } from '@/lib/api/client';
import type { AreaSuggestion } from '@/lib/onboarding/area-suggestions';
import { trpcClient } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Loader2, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { listJoin } from './onboarding-flow';
import { Card, PrimaryButton, QuietButton, Says } from './onboarding-ui';

/** The reply when no areas were added. */
export const NO_AREAS = 'No areas for now';

/** Always on offer, and the pick until suggestions arrive. */
export const AREA_PRESETS: readonly AreaSuggestion[] = [
  { name: 'Work', emoji: '💼' },
  { name: 'Personal', emoji: '🏡' },
];

/**
 * Suggestions from what the person said they're working on and the projects
 * they brought in, asked for as soon as there's something to go on so they're
 * usually ready by the time the step shows.
 */
export function useAreaSuggestions(input: { about: string; projects: string[] }, enabled: boolean) {
  const about = input.about.trim();
  return useQuery({
    queryKey: ['onboarding', 'area-suggestions', about, input.projects],
    queryFn: () => trpcClient.onboarding.areaSuggestionsPost.mutate({body: { about, projects: input.projects }}),
    enabled: enabled && (about.length > 0 || input.projects.length > 0),
    staleTime: Infinity,
    retry: false,
  });
}

/** The chips to offer: suggestions first, then the presets they don't already cover. */
export function areaOptions(suggestions: readonly AreaSuggestion[]): AreaSuggestion[] {
  const seen = new Set(suggestions.map((a) => a.name.toLowerCase()));
  return [...suggestions, ...AREA_PRESETS.filter((p) => !seen.has(p.name.toLowerCase()))];
}

export function areasLines(hasSuggestions: boolean): ReactNode {
  return (
    <>
      <Says>
        Want me to keep things in areas? They group your tasks, notes and agents, so you can look at one part of
        your life at a time.
      </Says>
      <Says>{hasSuggestions ? 'Here’s what I’d start with, from what you’ve told me.' : 'Pick any that fit, or add your own.'}</Says>
    </>
  );
}

export function AreasStep({
  suggestions,
  suggesting,
  onDone,
}: {
  suggestions: readonly AreaSuggestion[];
  suggesting: boolean;
  onDone: (reply: string) => void;
}) {
  const { data: existing } = useAreas();
  const createArea = useCreateArea();
  const [custom, setCustom] = useState<AreaSuggestion[]>([]);
  const [draft, setDraft] = useState('');
  // Null until the person touches a chip: the pick follows the suggestions
  // as they arrive, then stays theirs.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);

  const options = [...areaOptions(suggestions), ...custom];
  const selected = picked ?? new Set((suggestions.length ? suggestions : AREA_PRESETS).map((a) => a.name));
  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setPicked(next);
  };
  const addCustom = () => {
    const name = draft.replace(/\s+/g, ' ').trim().slice(0, 32);
    if (!name) return;
    if (!options.some((o) => o.name.toLowerCase() === name.toLowerCase())) setCustom((c) => [...c, { name, emoji: '📁' }]);
    setPicked(new Set([...selected, name]));
    setDraft('');
  };

  const save = async () => {
    const chosen = options.filter((o) => selected.has(o.name));
    if (chosen.length === 0) return onDone(NO_AREAS);
    setSaving(true);
    const have = new Set((existing ?? []).map((a) => a.name.toLowerCase()));
    try {
      for (const [i, area] of chosen.entries()) {
        if (have.has(area.name.toLowerCase())) continue;
        await createArea.mutateAsync({ name: area.name, emoji: area.emoji, attachments: [], sortOrder: i });
      }
      onDone(listJoin(chosen.map((a) => `${a.emoji} ${a.name}`)));
    } catch (err) {
      toast.error('Couldn’t add those areas', { description: apiErrorText(err) });
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map((option) => {
          const on = selected.has(option.name);
          return (
            <button
              key={option.name}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(option.name)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors',
                on ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/50',
              )}
            >
              <span className="leading-none">{option.emoji}</span>
              {option.name}
              {on && <Check size={11} className="text-primary" />}
            </button>
          );
        })}
        {suggesting && (
          <span className="inline-flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
            <Loader2 size={11} className="animate-spin" /> Thinking of a few for you
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Add your own"
          aria-label="Add an area"
          className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <QuietButton onClick={addCustom}>
          <span className="inline-flex items-center gap-1">
            <Plus size={11} /> Add
          </span>
        </QuietButton>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5">
        <QuietButton onClick={() => onDone(NO_AREAS)}>Skip</QuietButton>
        <PrimaryButton disabled={selected.size === 0} busy={saving} onClick={() => void save()}>
          Continue <ArrowRight size={12} />
        </PrimaryButton>
      </div>
    </Card>
  );
}
