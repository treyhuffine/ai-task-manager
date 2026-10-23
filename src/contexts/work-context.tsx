'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { AgentTab } from '@/types/dashboard';

/** Destinations supplied by the owning document, independent of personal panels. */
export interface WorkNavigation {
  openAgent: (id: string, tab?: AgentTab, chatId?: string) => void;
  openExecution: (chatId: string) => void;
  /** Exact source link, retaining its history and message target. */
  openLinkedChat?: (chatId: string, eventId?: string) => void;
  openTask: (id: string) => void;
  openNote: (id: string) => void;
  goHome: () => void;
  openCurrentChat?: (workspaceId: string | null) => void;
}
/** Viewer state for shared agent/chat surfaces. This grants no server authority. */
export interface WorkActivity {
  activeSessionId: string | null;
  activeExecutionId?: string | null;
  streamingSessionIds: ReadonlySet<string>;
  backgroundSessionIds: ReadonlySet<string>;
  pendingInputSessionIds: ReadonlySet<string>;
  setActiveExecutionId: (id: string | null) => void;
  setSessionStreaming: (chatId: string, running: boolean) => void;
}
const Navigation = createContext<WorkNavigation | null>(null);
const Activity = createContext<WorkActivity | null>(null);

export function WorkContext({ navigation, activity, children }: { navigation: WorkNavigation; activity: WorkActivity; children?: ReactNode }) {
  return <Navigation.Provider value={navigation}><Activity.Provider value={activity}>{children}</Activity.Provider></Navigation.Provider>;
}
export function useWorkNavigation() {
  const value = useOptionalWorkNavigation();
  if (!value) throw new Error('Work surfaces require their document navigation.');
  return value;
}
export function useOptionalWorkNavigation() { return useContext(Navigation); }
export function useOptionalWorkActivity() { return useContext(Activity); }
export function useWorkActivity() {
  const value = useContext(Activity);
  if (!value) throw new Error('Work surfaces require their document activity.');
  return value;
}
