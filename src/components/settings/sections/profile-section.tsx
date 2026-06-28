'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state';
import { DeckSourcesField } from './deck-sources-field';

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Your identity + the free-form context the agents build on. Name saves on
 * blur; the "about you" description debounced-saves to `user_state.description`.
 * Both seed every plan and every agent reply, so this pane leads the modal and
 * sells why filling it in is worth the minute.
 */
export function ProfileSection() {
  const { data: userState } = useUserState();
  const updateUserState = useUpdateUserState();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [, setTick] = useState(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (userState) setName(userState.name ?? '');
  }, [userState?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (userState) setDescription(userState.description);
  }, [userState?.description]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDescriptionChange = useCallback(
    (value: string) => {
      setDescription(value);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateUserState.mutate({ description: value }, { onSuccess: () => setLastSavedAt(new Date()) });
      }, 500);
    },
    [updateUserState],
  );

  const commitName = useCallback(() => {
    const next = name.trim();
    if (next === (userState?.name ?? '')) return;
    updateUserState.mutate({ name: next || null }, { onSuccess: () => setLastSavedAt(new Date()) });
  }, [name, userState?.name, updateUserState]);

  // Keep "last saved" fresh.
  useEffect(() => {
    if (!lastSavedAt) return;
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [lastSavedAt]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  return (
    <div className="space-y-5">
      {/* Why this matters — the pitch, up front and unmuted. */}
      <div className="rounded-xl border border-primary/20 border-l-2 border-l-primary bg-primary/5 p-4">
        <p className="text-[12.5px] leading-relaxed text-foreground/90">
          This is the context your agents build on. The more they know about you (your role, how you work, what
          you&apos;re focused on), the sharper your daily plan gets and the more their replies feel like they actually
          know you. Worth a minute now. It pays off in every chat.
        </p>
      </div>

      {/* Name */}
      <section className="space-y-2">
        <label htmlFor="profile-name" className="block text-[12px] font-medium text-foreground">
          What should we call you?
        </label>
        <input
          id="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          placeholder="e.g. Trey"
          className="w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </section>

      {/* About you */}
      <section className="space-y-2">
        <label htmlFor="profile-about" className="block text-[12px] font-medium text-foreground">
          About you
        </label>
        <textarea
          id="profile-about"
          value={description}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          placeholder="e.g. I'm a founder building a B2B SaaS product. I do my best deep work before noon. I tend to procrastinate on financial tasks..."
          className="h-48 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="text-[11px] text-muted-foreground/60">
          {updateUserState.isPending ? 'Saving…' : lastSavedAt ? `Last saved ${timeAgo(lastSavedAt)}` : 'Auto-saved'}
        </p>
      </section>

      {/* Deck sources (DECK.md) — which connected services the deck consults. */}
      <DeckSourcesField />
    </div>
  );
}
