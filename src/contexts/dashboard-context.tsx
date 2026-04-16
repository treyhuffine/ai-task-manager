"use client";

import { createContext, useContext, useState, useCallback, type ReactNode, useEffect } from 'react';
import type { Theme, WorkMode, ActiveView, AnyPanelTab, PanelId, MobileTab, Agent, Task, StreamEvent } from '@/types/dashboard';

interface FocusTask {
  title: string;
  project: string;
  context?: string;
  taskId: string;
}

// ─── Slideout navigation stack ──────────────────────────────────
// Each entry is a discriminated union. New slideout types just add a member.

export type SlideoutEntry =
  | { type: 'areas-list' }
  | { type: 'area'; id: string }
  | { type: 'task'; id: string }
  | { type: 'note'; id: string };

// Controls what the default close gesture (X / back button) does.
// 'back'    — pop one level (navigate to previous slideout)
// 'dismiss' — close everything
export type SlideoutCloseBehavior = 'back' | 'dismiss';

const SLIDEOUT_CLOSE_BEHAVIOR: SlideoutCloseBehavior = 'back';

interface DashboardState {
  theme: Theme;
  activeView: ActiveView;
  panelATab: AnyPanelTab;
  panelBTab: AnyPanelTab;
  dividerPosition: number;
  focusedPanel: PanelId;
  isFocusMode: boolean;
  focusTask: FocusTask | null;
  workMode: WorkMode;
  selectedProject: string;
  agents: Agent[];
  tasks: Task[];
  streamEvents: StreamEvent[];
  // Derived from slideout stack for convenience — consumers don't need to know about the stack
  openNoteId: string | null;
  openTaskId: string | null;
  openAreaId: string | null;
  areasListOpen: boolean;
  slideoutStack: SlideoutEntry[];
  slideoutCloseBehavior: SlideoutCloseBehavior;
  // Voice chat hotkey trigger — set to a panel ID to tell that panel's ChatContent to start voice
  voiceChatPanelTarget: PanelId | null;
  // Deck navigation — set by chat [[deck:ID]] cards to show a specific deck
  activeDeckId: string | null;
  // Mobile navigation
  mobileTab: MobileTab;
  mobileCreateOpen: boolean;
}

interface DashboardActions {
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setActiveView: (view: ActiveView) => void;
  setPanelTab: (panel: PanelId, tab: AnyPanelTab) => void;
  setDividerPosition: (pos: number) => void;
  setFocusedPanel: (panel: PanelId) => void;
  resetLayout: () => void;
  setIsFocusMode: (focus: boolean) => void;
  enterFocusMode: (task: FocusTask) => void;
  exitFocusMode: () => void;
  toggleFocusMode: () => void;
  setWorkMode: (mode: WorkMode) => void;
  setSelectedProject: (project: string) => void;
  // Convenience helpers that push onto the slideout stack
  openNote: (noteId: string) => void;
  openTask: (taskId: string) => void;
  openArea: (areaId: string) => void;
  openAreasList: () => void;
  // Stack navigation
  pushSlideout: (entry: SlideoutEntry) => void;
  popSlideout: () => void;
  closeAllSlideouts: () => void;
  // Legacy close aliases — these call popSlideout or closeAll based on behavior setting
  closeNote: () => void;
  closeTask: () => void;
  closeArea: () => void;
  // Voice chat hotkey
  triggerVoiceChat: () => void;
  clearVoiceChatTrigger: () => void;
  // Deck navigation
  openDeck: (deckId: string) => void;
  clearActiveDeckId: () => void;
  // Mobile navigation
  setMobileTab: (tab: MobileTab) => void;
  setMobileCreateOpen: (open: boolean) => void;
}

type DashboardContextType = DashboardState & DashboardActions;

const DashboardContext = createContext<DashboardContextType | null>(null);

const MOCK_AGENTS: Agent[] = [
  { id: "bounce", name: "Bounce", status: "active", task: "Building coach onboarding flow", color: "text-orange-500", bg: "bg-orange-500/10", progress: 65, icon: "\uD83C\uDFBE", lastUpdate: "Component ready in ~12 min" },
  { id: "insider", name: "InsiderFinance", status: "active", task: "Competitor pricing analysis", color: "text-blue-400", bg: "bg-blue-400/10", progress: 88, icon: "\uD83D\uDCCA", lastUpdate: "Found 3 new pricing tiers" },
  { id: "ri", name: "Ri", status: "idle", task: null, color: "text-muted-foreground", bg: "bg-muted", progress: 0, icon: "\uD83E\uDDE0", lastUpdate: null },
];

const MOCK_TASKS: Task[] = [
  { id: 1, text: "Review Bounce onboarding component", project: "Bounce", due: "Today", status: "ready", color: "bg-orange-500" },
  { id: 2, text: "Review InsiderFinance pricing analysis", project: "Insider", due: "Today", status: "waiting", color: "bg-blue-400" },
  { id: 3, text: "Spark learning loop wireframes", project: "Spark", due: "Tomorrow", status: "todo", color: "bg-amber-500" },
  { id: 4, text: "Bloom: pediatric sleep data sources", project: "Bloom", due: "Friday", status: "todo", color: "bg-emerald-500" },
  { id: 5, text: "Personal: March investor update", project: "Personal", due: "Mar 22", status: "todo", color: "bg-zinc-500" },
  { id: 6, text: "Eon contact sync bug", project: "Eon", due: null, status: "todo", color: "bg-pink-500" },
  { id: 7, text: "Ri: plan v2 knowledge graph schema", project: "Ri", due: "Next Week", status: "todo", color: "bg-muted-foreground" },
];

const MOCK_STREAM_EVENTS: StreamEvent[] = [
  { text: "Decided: Weaviate for Ri vector layer", time: "9:04 am", color: "bg-muted-foreground" },
  { text: "Insider agent: competitor price change flagged", time: "8:52 am", color: "bg-blue-400" },
  { text: "Rationale queued to Slack via Orchestrator", time: "8:10 am", color: "bg-zinc-500" },
];

const DEFAULT_PANEL_A_TAB: AnyPanelTab = 'deck';
const DEFAULT_PANEL_B_TAB: AnyPanelTab = 'chat';
const DEFAULT_DIVIDER_POSITION = 50;

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [activeView, setActiveView] = useState<ActiveView>('command');
  const [panelATab, setPanelATab] = useState<AnyPanelTab>(DEFAULT_PANEL_A_TAB);
  const [panelBTab, setPanelBTab] = useState<AnyPanelTab>(DEFAULT_PANEL_B_TAB);
  const [dividerPosition, setDividerPosition] = useState(DEFAULT_DIVIDER_POSITION);
  const [focusedPanel, setFocusedPanel] = useState<PanelId>('a');
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [focusTask, setFocusTask] = useState<FocusTask | null>(null);
  const [workMode, setWorkMode] = useState<WorkMode>(null);
  const [selectedProject, setSelectedProject] = useState('All Projects');
  // ─── Voice chat hotkey trigger ──────────────────────────────
  const [voiceChatPanelTarget, setVoiceChatPanelTarget] = useState<PanelId | null>(null);
  // ─── Deck navigation ──────────────────────────────────────
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  // ─── Mobile navigation ──────────────────────────────────────
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const [mobileCreateOpen, setMobileCreateOpen] = useState(false);

  // ─── Slideout stack ──────────────────────────────────────────
  const [slideoutStack, setSlideoutStack] = useState<SlideoutEntry[]>([]);

  const pushSlideout = useCallback((entry: SlideoutEntry) => {
    setSlideoutStack(prev => [...prev, entry]);
  }, []);

  const popSlideout = useCallback(() => {
    setSlideoutStack(prev => prev.slice(0, -1));
  }, []);

  const closeAllSlideouts = useCallback(() => {
    setSlideoutStack([]);
  }, []);

  // Default close = back or dismiss, based on config
  const defaultClose = SLIDEOUT_CLOSE_BEHAVIOR === 'back' ? popSlideout : closeAllSlideouts;

  // Convenience helpers — push onto the stack
  const openNote = useCallback((noteId: string) => pushSlideout({ type: 'note', id: noteId }), [pushSlideout]);
  const openTask = useCallback((taskId: string) => pushSlideout({ type: 'task', id: taskId }), [pushSlideout]);
  const openArea = useCallback((areaId: string) => pushSlideout({ type: 'area', id: areaId }), [pushSlideout]);
  const openAreasList = useCallback(() => pushSlideout({ type: 'areas-list' }), [pushSlideout]);

  // Legacy close aliases
  const closeNote = defaultClose;
  const closeTask = defaultClose;
  const closeArea = defaultClose;

  // Derive individual IDs from top of stack for backward compat
  const topSlideout = slideoutStack[slideoutStack.length - 1] ?? null;
  const openNoteId = topSlideout?.type === 'note' ? topSlideout.id : null;
  const openTaskId = topSlideout?.type === 'task' ? topSlideout.id : null;
  const openAreaId = topSlideout?.type === 'area' ? topSlideout.id : null;
  const areasListOpen = topSlideout?.type === 'areas-list';

  // Sync dark class to <html> so Radix portals (Sheet, Dialog, etc.) inherit it
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  const enterFocusMode = useCallback((task: FocusTask) => {
    setFocusTask(task);
    setIsFocusMode(true);
  }, []);

  const exitFocusMode = useCallback(() => {
    setIsFocusMode(false);
    setFocusTask(null);
  }, []);

  const toggleFocusMode = useCallback(() => {
    setIsFocusMode(prev => !prev);
  }, []);

  const setPanelTab = useCallback((panel: PanelId, tab: AnyPanelTab) => {
    if (panel === 'a') setPanelATab(tab);
    else setPanelBTab(tab);
  }, []);

  const resetLayout = useCallback(() => {
    setPanelATab(DEFAULT_PANEL_A_TAB);
    setPanelBTab(DEFAULT_PANEL_B_TAB);
    setDividerPosition(DEFAULT_DIVIDER_POSITION);
    setFocusedPanel('a');
  }, []);

  const triggerVoiceChat = useCallback(() => {
    const aHasChat = panelATab === 'chat';
    const bHasChat = panelBTab === 'chat';

    let target: PanelId;
    if (aHasChat && !bHasChat) {
      target = 'a';
    } else if (bHasChat && !aHasChat) {
      target = 'b';
    } else if (aHasChat && bHasChat) {
      target = focusedPanel;
    } else {
      // Neither has chat — default to panel B (right)
      target = 'b';
      setPanelBTab('chat');
    }

    setVoiceChatPanelTarget(target);
  }, [panelATab, panelBTab, focusedPanel]);

  const clearVoiceChatTrigger = useCallback(() => {
    setVoiceChatPanelTarget(null);
  }, []);

  const openDeck = useCallback((deckId: string) => {
    setActiveDeckId(deckId);
    // Switch a panel to deck tab — prefer whichever panel already has the deck,
    // otherwise use the panel that doesn't have chat
    const aHasDeck = panelATab === 'deck';
    const bHasDeck = panelBTab === 'deck';
    if (!aHasDeck && !bHasDeck) {
      // Neither panel has deck — put it on whichever isn't chat
      const aHasChat = panelATab === 'chat';
      if (aHasChat) {
        setPanelBTab('deck');
      } else {
        setPanelATab('deck');
      }
    }
  }, [panelATab, panelBTab]);

  const clearActiveDeckId = useCallback(() => {
    setActiveDeckId(null);
  }, []);

  return (
    <DashboardContext.Provider value={{
      theme,
      activeView,
      panelATab,
      panelBTab,
      dividerPosition,
      focusedPanel,
      isFocusMode,
      focusTask,
      workMode,
      selectedProject,
      agents: MOCK_AGENTS,
      tasks: MOCK_TASKS,
      streamEvents: MOCK_STREAM_EVENTS,
      setTheme,
      toggleTheme,
      setActiveView,
      setPanelTab,
      setDividerPosition,
      setFocusedPanel,
      resetLayout,
      setIsFocusMode,
      enterFocusMode,
      exitFocusMode,
      toggleFocusMode,
      setWorkMode,
      setSelectedProject,
      openNoteId,
      openNote,
      closeNote,
      openTaskId,
      openTask,
      closeTask,
      openAreaId,
      openArea,
      closeArea,
      areasListOpen,
      openAreasList,
      slideoutStack,
      slideoutCloseBehavior: SLIDEOUT_CLOSE_BEHAVIOR,
      pushSlideout,
      popSlideout,
      closeAllSlideouts,
      voiceChatPanelTarget,
      triggerVoiceChat,
      clearVoiceChatTrigger,
      activeDeckId,
      openDeck,
      clearActiveDeckId,
      mobileTab,
      setMobileTab,
      mobileCreateOpen,
      setMobileCreateOpen,
    }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
}
