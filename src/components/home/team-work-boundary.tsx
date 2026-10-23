'use client';

import { useHomeContext } from './home-context';
import { ChatCapabilities } from '@/components/chat-ui/chat-capabilities';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { WorkContext } from '@/contexts/work-context';
import { useTeamNav } from '@/components/team/team-context';
import { useRailSessions } from '@/hooks/use-workspaces';
import { useGlobalSessionStream } from '@/hooks/use-global-session-stream';
import { SettingsDestinationProvider, type SettingsDestination } from '@/components/settings/settings-destination';

const TEAM_CHAT_CAPABILITIES = { deliveryReceipts: false, prepareResults: true, coordination: false };

/** The team's route supplies the same navigation and activity contract as personal Ri. */
export function TeamWorkBoundary({ children }: { children: ReactNode }) {
  const nav = useTeamNav();
  const canConfigureModels = useHomeContext().capabilities.configureAgents;
  const rail = useRailSessions();
  useGlobalSessionStream();
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
  const [localRunning, setLocalRunning] = useState<ReadonlySet<string>>(() => new Set());
  const setSessionStreaming = useCallback((id: string, running: boolean) => setLocalRunning(previous => {
    if (previous.has(id) === running) return previous;
    const next = new Set(previous); if (running) next.add(id); else next.delete(id); return next;
  }), []);
  const navigation = useMemo(() => ({ openAgent: nav.openAgent, openExecution: nav.openChat, openTask: nav.openTask, openNote: nav.openNote, goHome: () => nav.show('board'), openCurrentChat: (id: string | null) => id ? nav.openAgent(id) : nav.openChat(null) }), [nav]);
  const settings = useMemo<SettingsDestination>(() => (section, options) => {
    if (!section) return () => nav.openSettings('general');
    if (section === 'voice') return () => nav.openSettings('voice');
    if (section === 'models') return canConfigureModels ? () => nav.openSettings('ai') : null;
    if (section === 'plugins' && options?.anchor === 'skills') return () => nav.openSettings('skills');
    return null;
  }, [nav, canConfigureModels]);
  const activity = useMemo(() => ({
    activeSessionId: nav.view === 'chat' ? nav.chatId : null, activeExecutionId,
    streamingSessionIds: new Set([...rail.data?.runningSessionIds ?? [], ...localRunning]),
    backgroundSessionIds: new Set(rail.data?.backgroundSessionIds ?? []),
    pendingInputSessionIds: new Set(rail.data?.pendingSessionIds ?? []),
    setActiveExecutionId, setSessionStreaming,
  }), [nav.view, nav.chatId, activeExecutionId, rail.data, localRunning, setSessionStreaming]);
  return <SettingsDestinationProvider value={settings}><WorkContext navigation={navigation} activity={activity}><ChatCapabilities.Provider value={TEAM_CHAT_CAPABILITIES}>{children}</ChatCapabilities.Provider></WorkContext></SettingsDestinationProvider>;
}
