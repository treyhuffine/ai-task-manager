"use client";

import { createContext, useContext, useState, useCallback, type ReactNode, useEffect } from 'react';
import type { Theme, WorkMode, ActiveView, AnyPanelTab, PanelId, Agent, Task, StreamEvent } from '@/types/dashboard';

interface FocusTask {
  title: string;
  project: string;
  context?: string;
  taskId: string;
}

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
  openNoteId: string | null;
  openTaskId: string | null;
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
  openNote: (noteId: string) => void;
  closeNote: () => void;
  openTask: (taskId: string) => void;
  closeTask: () => void;
}

type DashboardContextType = DashboardState & DashboardActions;

const DashboardContext = createContext<DashboardContextType | null>(null);

const MOCK_AGENTS: Agent[] = [
  { id: "bounce", name: "Bounce", status: "active", task: "Building coach onboarding flow", color: "text-orange-500", bg: "bg-orange-500/10", progress: 65, icon: "\uD83C\uDFBE", lastUpdate: "Component ready in ~12 min" },
  { id: "insider", name: "InsiderFinance", status: "active", task: "Competitor pricing analysis", color: "text-blue-400", bg: "bg-blue-400/10", progress: 88, icon: "\uD83D\uDCCA", lastUpdate: "Found 3 new pricing tiers" },
  { id: "ri", name: "Ri", status: "idle", task: null, color: "text-purple-400", bg: "bg-purple-400/10", progress: 0, icon: "\uD83E\uDDE0", lastUpdate: null },
];

const MOCK_TASKS: Task[] = [
  { id: 1, text: "Review Bounce onboarding component", project: "Bounce", due: "Today", status: "ready", color: "bg-orange-500" },
  { id: 2, text: "Review InsiderFinance pricing analysis", project: "Insider", due: "Today", status: "waiting", color: "bg-blue-400" },
  { id: 3, text: "Spark learning loop wireframes", project: "Spark", due: "Tomorrow", status: "todo", color: "bg-amber-500" },
  { id: 4, text: "Bloom: pediatric sleep data sources", project: "Bloom", due: "Friday", status: "todo", color: "bg-emerald-500" },
  { id: 5, text: "Personal: March investor update", project: "Personal", due: "Mar 22", status: "todo", color: "bg-zinc-500" },
  { id: 6, text: "Eon contact sync bug", project: "Eon", due: null, status: "todo", color: "bg-pink-500" },
  { id: 7, text: "Ri: plan v2 knowledge graph schema", project: "Ri", due: "Next Week", status: "todo", color: "bg-purple-500" },
];

const MOCK_STREAM_EVENTS: StreamEvent[] = [
  { text: "Decided: Weaviate for Ri vector layer", time: "9:04 am", color: "bg-purple-400" },
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
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const openNote = useCallback((noteId: string) => setOpenNoteId(noteId), []);
  const closeNote = useCallback(() => setOpenNoteId(null), []);
  const openTask = useCallback((taskId: string) => setOpenTaskId(taskId), []);
  const closeTask = useCallback(() => setOpenTaskId(null), []);

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
