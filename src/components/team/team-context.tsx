'use client';

import { createContext, useCallback, useContext, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

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

export type TeamView = 'board' | 'notes';

/**
 * Where this screen is in the team: its own URL, so a reload, a shared link
 * and the back button all keep it, and nothing another screen does moves it
 * (docs/homes-spec.md §3.2).
 */
export function useTeamNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view: TeamView = params.get('view') === 'notes' ? 'notes' : 'board';
  const taskId = params.get('task');
  const noteId = params.get('note');
  const areaId = params.get('area');
  const mine = params.get('mine') === '1';
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
      areaId,
      mine,
      panel,
      show: (next: TeamView) => set({ view: next === 'board' ? null : next }),
      openTask: (id: string) => set({ task: id, note: null }),
      openNote: (id: string) => set({ note: id, task: null }),
      closeDetail: () => set({ task: null, note: null }, 'replace'),
      filterArea: (id: string | null) => set({ area: id }, 'replace'),
      setMine: (on: boolean) => set({ mine: on ? '1' : null }, 'replace'),
      openPanel: (name: 'settings' | 'search' | null) => set({ panel: name }, name ? 'push' : 'replace'),
    }),
    [view, taskId, noteId, areaId, mine, panel, set],
  );
}
