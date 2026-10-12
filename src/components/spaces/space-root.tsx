'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { getAuthToken } from '@/lib/api/client';
import type { SpacePage } from '@/lib/spaces/page';
import { TeamGate } from '@/components/team/team-gate';

/** The team a space document shows inside My Ri, or null in the team's own app. */
export const SpaceContext = createContext<SpacePage | null>(null);

export function useSpace(): SpacePage | null {
  return useContext(SpaceContext);
}

/**
 * The root of a team's space inside My Ri (docs/homes-spec.md §3.2, P7.1):
 * the team's own app, reached through this home. Nothing personal mounts
 * here (no capture, banners, pairing or desktop service panel), since its
 * typed API is the team's. Signing in is My Ri's: without a session this
 * goes back to My Ri, which pairs as usual.
 */
export function SpaceRoot({ space, children }: { space: SpacePage; children: ReactNode }) {
  useEffect(() => {
    // Room for the desktop's window controls, as My Ri has.
    if (window.riDesktop) document.documentElement.dataset.riDesktop = window.riDesktop.platform;
    if (!getAuthToken()) window.location.replace('/');
  }, []);

  if (space.status !== 'active') {
    return (
      <SpaceContext.Provider value={space}>
        <TeamGate title={space.name ? `${space.name} isn't connected` : "This team isn't connected to My Ri"}>
          <p>
            {space.status === 'revoked'
              ? `${space.name} no longer accepts this Ri's sign-in. Connect it again with a sign-in link from the team.`
              : 'Connect a team in Settings, Teams, with an invitation or a sign-in link from it.'}
          </p>
          {/* A whole page: My Ri is its own document (src/lib/spaces/document.ts). */}
          <button type="button" onClick={() => window.location.assign('/?settings=teams')} className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            Open Settings, Teams
          </button>
        </TeamGate>
      </SpaceContext.Provider>
    );
  }
  return <SpaceContext.Provider value={space}>{children}</SpaceContext.Provider>;
}
