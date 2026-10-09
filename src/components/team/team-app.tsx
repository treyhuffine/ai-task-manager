'use client';

import { Suspense, useEffect, useSyncExternalStore } from 'react';
import { PAIRING_TOKEN_FRAGMENT_KEY } from '@/constants/app';
import { getAuthToken, TEAM_SIGNED_OUT_EVENT } from '@/lib/api/client';
import { keepTeamSignIn } from '@/lib/team/client';
import { TeamShell } from './team-shell';
import { TeamSignedOut } from './team-signed-out';

function subscribe(listener: () => void) {
  window.addEventListener(TEAM_SIGNED_OUT_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(TEAM_SIGNED_OUT_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

/**
 * A team space's home (docs/homes-spec.md §3.2): its shared work for a
 * signed-in member, how to get in otherwise. Nothing personal mounts here,
 * so a member never meets a main chat, deck, agents or setup.
 */
export function TeamApp() {
  // This browser's key for the team, followed as it signs in and out.
  const token = useSyncExternalStore(subscribe, getAuthToken, () => undefined);
  // The desktop opens a team with this member's key in the fragment, which
  // getAuthToken already kept. Set the team's cookie and take it out of the address.
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const fromLink = params.get(PAIRING_TOKEN_FRAGMENT_KEY);
    if (!fromLink) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    void keepTeamSignIn(fromLink);
  }, []);
  if (token === undefined) return null;
  if (!token) return <TeamSignedOut />;
  return (
    <Suspense fallback={null}>
      <TeamShell />
    </Suspense>
  );
}
