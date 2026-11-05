'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { ChatCapabilities } from '@/components/chat-ui/chat-capabilities';
import { SettingsDestinationProvider, type SettingsDestination } from '@/components/settings/settings-destination';
import { LifecycleGuardProvider } from '@/components/tasks/lifecycle-guard';
import { useTeam, useTeamNav } from '@/components/team/team-context';
import { useHomeContext } from './home-context';

const CHAT_CAPABILITIES = { deliveryReceipts: false, prepareResults: true, coordination: false };

/** Only Team policy belongs here. The application's navigation and activity are shared. */
export function TeamDashboardBoundary({ children }: { children: ReactNode }) {
  const { team } = useTeam();
  const nav = useTeamNav();
  const canConfigure = useHomeContext().capabilities.configureAgents;
  const settings = useMemo<SettingsDestination>(() => (section, options) => {
    if (!section || section === 'general') return () => nav.openSettings('general');
    if (section === 'voice') return () => nav.openSettings('voice');
    if (section === 'models') return canConfigure ? () => nav.openSettings('ai') : null;
    if (section === 'plugins' && options?.anchor === 'skills') return () => nav.openSettings('skills');
    return null;
  }, [nav, canConfigure]);
  useEffect(() => { document.title = team.name; }, [team.name]);
  return <SettingsDestinationProvider value={settings}><ChatCapabilities.Provider value={CHAT_CAPABILITIES}><LifecycleGuardProvider>{children}</LifecycleGuardProvider></ChatCapabilities.Provider></SettingsDestinationProvider>;
}
