'use client';

import { createContext, useCallback, useContext, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { TeamSettingsSectionId } from './team-settings-sections';

export interface TeamIdentity {
  team: { id: string; name: string; members: number; hostedOn: string | null };
  member: { id: string; name: string; role: 'owner' | 'member' };
}

export const TeamContext = createContext<TeamIdentity | null>(null);

/** The team and the signed-in member. Only inside a team's shell. */
export function useTeam(): TeamIdentity {
  const value = useContext(TeamContext);
  if (!value) throw new Error('useTeam is only for a team space.');
  return value;
}

export type TeamView = 'board' | 'notes' | 'chat';

/**
 * Where this screen is in the team: its own URL, so a reload, a shared link
 * and the back button all keep it, and nothing another screen does moves it
 * (docs/homes-spec.md §3.2).
 */
export function useTeamNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const rawView = params.get('view');
  const view: TeamView = rawView === 'notes' || rawView === 'chat' ? rawView : 'board';
  const taskId = params.get('task');
  const noteId = params.get('note');
  /** The shared chat open in the Chat view (docs/homes-spec.md §9.9). */
  const chatId = params.get('chat');
  const areaId = params.get('area');
  const mine = params.get('mine') === '1';
  /** Notes marked as decisions only (docs/homes-spec.md §9.7). */
  const decisions = params.get('kind') === 'decision';
  const panel = params.get('panel');

  const set = useCallback(
    (changes: Record<string, string | null>, mode: 'push' | 'replace' = 'push') => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      const url = query ? `${pathname}?${query}` : pathname;
      if (mode === 'replace') router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [params, pathname, router],
  );

  return useMemo(
    () => ({
      view,
      taskId,
      noteId,
      chatId,
      areaId,
      mine,
      decisions,
      panel,
      settingsSection: params.get('settings'),
      openSettings: (section: TeamSettingsSectionId) => set({ panel: 'settings', settings: section }),
      remoteSetup: params.get('setup') === 'remote',
      finishRemoteSetup: () => set({ setup: null, panel: null, settings: null }, 'replace'),
      show: (next: TeamView) => set({ view: next === 'board' ? null : next }),
      openTask: (id: string) => set({ task: id, note: null }),
      openNote: (id: string) => set({ note: id, task: null }),
      openChat: (id: string | null) => set({ view: 'chat', chat: id, task: null, note: null, panel: null }),
      closeDetail: () => set({ task: null, note: null }, 'replace'),
      filterArea: (id: string | null) => set({ area: id }, 'replace'),
      setMine: (on: boolean) => set({ mine: on ? '1' : null }, 'replace'),
      setDecisions: (on: boolean) => set({ kind: on ? 'decision' : null }, 'replace'),
      openPanel: (name: 'settings' | 'search' | null) => set({ panel: name, settings: null }, name ? 'push' : 'replace'),
    }),
    [view, taskId, noteId, chatId, areaId, mine, decisions, panel, set, params],
  );
}
