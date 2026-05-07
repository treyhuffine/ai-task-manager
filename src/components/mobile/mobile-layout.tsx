"use client";

import { useDashboard } from '@/contexts/dashboard-context';
import { ContentPanel } from '@/components/dashboard/content-panel';
import { ExecutionView } from '@/components/executions/execution-view';
import { MobileAgentsView } from './mobile-agents-view';
import { MobileMoreView } from './mobile-more-view';
import { MobileTabBar } from './mobile-tab-bar';
import { MobileTopBar } from './mobile-top-bar';
import { MobileCreateSheet } from './mobile-create-sheet';

export function MobileLayout() {
  const { mobileTab, activeView } = useDashboard();

  // When the user has tapped into a session (activeView is a session id,
  // not 'command'), the agents tab takes over the whole content area
  // with the chat surface — header + transcript + composer. The
  // ExecutionHeader's close button (which calls setActiveView('command'))
  // brings them back to the workspaces list. Other tabs aren't affected.
  const isExecutionActive = activeView !== 'command';

  const renderContent = () => {
    if (mobileTab === 'agents' && isExecutionActive) {
      return <ExecutionView sessionId={activeView} />;
    }
    switch (mobileTab) {
      case 'chat':
        return <ContentPanel panelId="a" mobileTab="chat" />;
      case 'deck':
        return <ContentPanel panelId="a" mobileTab="deck" />;
      case 'agents':
        return <MobileAgentsView />;
      case 'more':
        return <MobileMoreView />;
      default:
        return <ContentPanel panelId="a" mobileTab="chat" />;
    }
  };

  // Hide the search/inbox top bar while in an execution chat — the
  // ExecutionHeader already serves as the page header on that screen.
  const showTopBar = !(mobileTab === 'agents' && isExecutionActive);

  return (
    <>
      {showTopBar && <MobileTopBar />}
      {/* flex-col so children (each content view + ExecutionView) get
          full width via cross-axis stretch and grow vertically through
          flex-1. Without this, ExecutionView's outer `flex flex-1`
          can't propagate (its previous parent was a non-flex block) and
          the composer floats up to wherever the transcript ends instead
          of pinning to the bottom of the viewport. Existing content
          views (`h-full` AgentsView / MoreView / ContentPanel) keep
          working because the parent now has an explicit computed
          height. */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {renderContent()}
      </div>
      <MobileTabBar />
      <MobileCreateSheet />
    </>
  );
}
