'use client';

import { TeamRail, useShowAgents, useShowChat } from '@/components/team/team-rail';
import { LifecycleGuardProvider } from '@/components/tasks/lifecycle-guard';


import { MobileTopBar } from '@/components/mobile/mobile-top-bar';
import { TeamPhoneBar } from '@/components/team/team-phone-bar';
import { useEffect } from 'react';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { DOCUMENT_AUTHOR_CHANGED } from '@/lib/home/document-binding';
import { apiErrorCode, apiErrorStatus, apiErrorText } from '@/lib/api/client';
import { TeamContext, useTeam, useTeamNav } from '@/components/team/team-context';
import { useTeamMe } from '@/components/team/use-team';
import { TeamBoard } from '@/components/team/team-board';
import { NoteList } from '@/components/notes/note-list';
import { TeamChatDestination } from '@/components/team/team-chat-destination';
import { TeamRecordControls } from '@/components/team/team-record-controls';
import { TeamSettings } from '@/components/team/team-settings';
import { TeamSearch } from '@/components/team/team-search';
import { GateButton, TeamGate } from '@/components/team/team-gate';
import { useSpace } from '@/components/spaces/space-root';
import { HomeShell } from '@/components/home/home-shell';
import { HomeBoundary } from '@/components/home/home-context';
import { TeamWorkBoundary } from './team-work-boundary';
import { MobileAgentsView } from '@/components/mobile/mobile-agents-view';
import { AgentView } from '@/components/agents/agent-view';
import { LaunchModal } from '@/components/workspaces/launcher/launch-modal';
import { HomeLoading } from './home-loading';

/**
 * The shared Home shell with team destinations and live member authority.
 * Personal planning and connected account management stay in their owning Home.
 */
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
      <HomeBoundary expected={{ homeId: me.data.team.id, viewerId: me.data.member.id }}><TeamWorkBoundary><LifecycleGuardProvider><Shell /></LifecycleGuardProvider></TeamWorkBoundary></HomeBoundary>
    </TeamContext.Provider>
  );
}

/** This link must remain available even when the team's API never responds. */
function BackToMyRi() {
  // eslint-disable-next-line @next/next/no-html-link-for-pages -- A space change needs a new root layout and API client, not client-side routing.
  return <a href="/" className="inline-flex h-9 w-full items-center justify-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-muted/50">Back to My Ri</a>;
}

function Shell() {
  const { team } = useTeam();
  const nav = useTeamNav();

  useEffect(() => {
    document.title = team.name;
  }, [team.name]);

  // ⌘K searches the team.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesHotkey(e, HOTKEYS.search)) {
        e.preventDefault();
        nav.openPanel('search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  return (
    <HomeShell
      navigation={<TeamRail />}
      phoneHeader={<PhoneTopBar />}
      phoneNavigation={<PhoneTabBar />}
      overlays={<><TeamRecordControls /><TeamSettings /><TeamSearch /><LaunchModal /></>}
    >
      <div className="flex min-h-0 flex-1 flex-col @container/lt"><TeamContent /></div>
    </HomeShell>
  );
}

/** Native routes reuse the normal agent and execution screens. Legacy URLs stay valid. */
function TeamContent() {
  const nav = useTeamNav();
  if (nav.view === 'agents') return nav.agentId
    ? <AgentView workspaceId={nav.agentId} tab={nav.agentTab} onBack={() => nav.show('agents')} />
    : <MobileAgentsView />;
  if (nav.view === 'chat') return <TeamChatDestination />;
  if (nav.view === 'notes') return <NoteList decisionsOnly={nav.decisions} onDecisionsChange={nav.setDecisions} onOpenNote={nav.openNote} privatePlanning={false} areaFilter={nav.areaId ?? 'all'} onAreaFilterChange={value => nav.filterArea(value === 'all' ? null : value)} onSearch={() => nav.openPanel('search')} />;
  return <TeamBoard />;
}
function PhoneTopBar() {
  const nav = useTeamNav();
  return <MobileTopBar onSearch={() => nav.openPanel('search')} onOpenSettings={() => nav.openPanel('settings')}/>;
}

function PhoneTabBar() {
  const showChat = useShowChat();
  const showAgents = useShowAgents();
  return <TeamPhoneBar showChat={showChat} showAgents={showAgents}/>;
}
