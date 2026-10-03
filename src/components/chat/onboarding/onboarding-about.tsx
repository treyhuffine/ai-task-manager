'use client';

import { useUpdateUserState } from '@/hooks/use-user-state';
import { apiErrorText } from '@/lib/api/client';
import type { ProjectSummary } from '@/lib/onboarding/about-suggestion';
import { trpcClient } from '@/lib/trpc/client';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Card, PrimaryButton, QuietButton, Says } from './onboarding-ui';

/** The reply when the person passes on it. */
export const ABOUT_SKIPPED = 'Skip for now';

/**
 * A draft of what the person is working on, written from their recent agent
 * history and asked for as soon as that history is known, so it's usually
 * ready by the time the step shows.
 */
export function useAboutDraft(input: { userName: string | null; projects: ProjectSummary[] }, enabled: boolean) {
  return useQuery({
    queryKey: ['onboarding', 'about-draft', input.projects.map((p) => p.name)],
    queryFn: () => trpcClient.onboarding.aboutSuggestionPost.mutate({body: input}),
    enabled: enabled && input.projects.length > 0,
    staleTime: Infinity,
    retry: false,
  });
}

export function aboutQuestion() {
  return (
    <Says>
      From your recent work, here’s what it looks like you’re focused on. Fix anything I got wrong. It helps me
      plan your days, and your agents get the context too.
    </Says>
  );
}

/**
 * Confirm or fix the draft. While it's being written, the step says so and
 * can be skipped. Without a draft (the call failed), it's a plain field.
 */
export function AboutStep({
  draft,
  drafting,
  onDone,
}: {
  draft: string;
  drafting: boolean;
  onDone: (reply: string) => void;
}) {
  const update = useUpdateUserState();
  // Null until edited: the field shows the draft as it arrives.
  const [edited, setEdited] = useState<string | null>(null);
  const text = edited ?? draft;
  const trimmed = text.trim();

  const save = () => {
    update.mutate(
      { description: trimmed },
      {
        onSuccess: () => onDone(trimmed),
        onError: (err) => toast.error('Couldn’t save that', { description: apiErrorText(err) }),
      },
    );
  };

  if (drafting && edited === null) {
    return (
      <Card className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 size={12} className="animate-spin" /> Reading your recent projects
        </span>
        <QuietButton onClick={() => onDone(ABOUT_SKIPPED)}>Skip</QuietButton>
      </Card>
    );
  }

  return (
    <Card>
      <textarea
        value={text}
        onChange={(e) => setEdited(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && trimmed) {
            e.preventDefault();
            save();
          }
        }}
        rows={3}
        placeholder="Building a new app, running a small studio, training for a marathon…"
        aria-label="What you're working on"
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <QuietButton onClick={() => onDone(ABOUT_SKIPPED)}>Skip</QuietButton>
        <PrimaryButton disabled={!trimmed} busy={update.isPending} onClick={save}>
          {edited === null && draft ? 'That’s right' : 'Save'} <ArrowRight size={12} />
        </PrimaryButton>
      </div>
    </Card>
  );
}
