'use client';

import { TeamContext } from '@/components/team/team-context';
import { useTeamMe } from '@/components/team/use-team';
import { GateButton, TeamGate } from '@/components/team/team-gate';
import { useSpace } from '@/components/spaces/space-root';
import { HomeBoundary } from '@/components/home/home-context';
import { HomeLoading } from './home-loading';
import { DOCUMENT_AUTHOR_CHANGED } from '@/lib/home/document-binding';
import { apiErrorCode, apiErrorStatus, apiErrorText } from '@/lib/api/client';
import { DashboardProvider } from '@/contexts/dashboard-context';
import { DashboardShell } from '@/components/dashboard/dashboard';
import { TeamDashboardBoundary } from './team-dashboard-boundary';

export function TeamHome() {
  const me = useTeamMe();
  const space = useSpace();
  if (me.isLoading) return <HomeLoading>{space && <div className="max-w-sm space-y-3 p-5 text-sm text-muted-foreground">
    <p>Waiting for the computer hosting {space.name ?? 'the team'}.</p>
    <BackToMyRi />
  </div>}</HomeLoading>;
  if (!me.data) {
    // A sign-in that stopped working signs this browser out on its own
    // (src/lib/api/client.ts). Anything else is the team being unreachable.
    if (apiErrorStatus(me.error) === 401) return null;
    if (apiErrorCode(me.error) === DOCUMENT_AUTHOR_CHANGED) return <TeamGate title="This sign-in changed"><p>Your drafts are kept for their original author.</p><GateButton onClick={() => window.location.reload()}>Reload</GateButton>{space && <BackToMyRi />}</TeamGate>;
    // Inside My Ri, the team can refuse this Ri's sign-in (docs/homes-spec.md §9.4).
    if (apiErrorCode(me.error) === 'team_signed_out') {
      return (
        <TeamGate title="This team no longer accepts this Ri">
          <p>{apiErrorText(me.error)} Your private planning for its work is kept in My Ri.</p>
          {/* A whole page: My Ri is its own document (src/lib/spaces/document.ts). */}
          <button type="button" onClick={() => window.location.assign('/?settings=teams')} className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            Open Settings, Teams
          </button>
        </TeamGate>
      );
    }
    return (
      <TeamGate title="This team can't be reached">
        <p>The computer hosting it may be asleep or offline. Nothing you wrote is lost.</p>
        <GateButton onClick={() => void me.refetch()}>Retry</GateButton>
        {space && <BackToMyRi />}
      </TeamGate>
    );
  }
  return (
    <TeamContext.Provider value={me.data}>
      <HomeBoundary expected={{ homeId: me.data.team.id, viewerId: me.data.member.id }}><DashboardProvider><TeamDashboardBoundary><DashboardShell /></TeamDashboardBoundary></DashboardProvider></HomeBoundary>
    </TeamContext.Provider>
  );
}

/** This link must remain available even when the team's API never responds. */
function BackToMyRi() {
  // eslint-disable-next-line @next/next/no-html-link-for-pages -- A space change needs a new root layout and API client, not client-side routing.
  return <a href="/" className="inline-flex h-9 w-full items-center justify-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-muted/50">Back to My Ri</a>;
}
