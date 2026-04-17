"use client";

import { useDashboard } from '@/contexts/dashboard-context';
import { ContentPanel } from '@/components/dashboard/content-panel';
import { MobileAgentsView } from './mobile-agents-view';
import { MobileMoreView } from './mobile-more-view';
import { MobileTabBar } from './mobile-tab-bar';
import { MobileTopBar } from './mobile-top-bar';
import { MobileCreateSheet } from './mobile-create-sheet';

export function MobileLayout() {
  const { mobileTab, setPanelTab } = useDashboard();

  // Sync panel A tab to match mobile tab for content views
  // Chat and Deck map directly to panel A tabs
  // Agents and More have their own dedicated views
  const renderContent = () => {
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

  return (
    <>
      <MobileTopBar />
      <div className="flex-1 min-h-0 overflow-hidden">
        {renderContent()}
      </div>
      <MobileTabBar />
      <MobileCreateSheet />
    </>
  );
}
