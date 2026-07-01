"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Theme, WorkMode, ActiveView, AnyPanelTab, PanelId, MobileTab, Agent, Task, StreamEvent } from '@/types/dashboard';
import { hot } from '@/lib/_debug/hot-path';

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
  // Execution that the active view's chat belongs to. The workspace tree
  // shows one row per execution (keyed to its primary chat), so when the
  // user is on a *sibling* chat, `activeView` (a chat id) won't match any
  // tree row. This lets the row stay highlighted for any chat of its
  // execution. Set by ExecutionView from the loaded session; null in the
  // command view / non-execution chats.
  activeExecutionId: string | null;
  panelATab: AnyPanelTab;
  panelBTab: AnyPanelTab;
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
  // Quick capture modal
  quickCaptureOpen: boolean;
  // Sessions currently streaming live agentex stdio. Filtered out of the
  // Needs Review surface and used for the workspace-row "● working" badge.
  // Populated by both the executor pipe (per-session) and the global rail
  // SSE stream (snapshot + flips), so the rail stays accurate even when no
  // execution view is open.
  streamingSessionIds: ReadonlySet<string>;
  // Sessions with at least one pending input (permission prompt /
  // AskUserQuestion blocking the agent). Drives the rail's "Needs
  // Approval" bucket. Sourced from the global SSE stream — `notify()` in
  // pending-input.ts publishes a full snapshot on every change.
  pendingInputSessionIds: ReadonlySet<string>;
  // Left rail visual mode. `true` renders the rail as a skinny icon
  // strip; `false` keeps the full-width labeled view. Persisted across
  // reloads in localStorage.
  railCollapsed: boolean;
  // Execution-view-only override. When in an execution view the rail
  // defaults to skinny regardless of `railCollapsed`; this flag lets
  // the user temporarily open it via the ⌘\ hotkey. Persisted so a
  // page reload doesn't snap it closed mid-task.
  executionRailOpen: boolean;
  // Most recently viewed execution session id. Updated every time
  // setActiveView is called with a session id; persisted to
  // localStorage so ⌘E from the dashboard can re-open the last
  // execution after a reload. Null until the user has opened one.
  lastExecutionId: string | null;
}

interface DashboardActions {
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setActiveView: (view: ActiveView) => void;
  setActiveExecutionId: (id: string | null) => void;
  setPanelTab: (panel: PanelId, tab: AnyPanelTab) => void;
  setFocusedPanel: (panel: PanelId) => void;
  resetLayout: () => void;
  // PanelLayout registers an imperative reset (e.g. setLayout([50, 50])) so
  // resetLayout can snap the divider back without owning panel-group state.
  registerPanelLayoutReset: (fn: (() => void) | null) => void;
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
  // Quick capture
  setQuickCaptureOpen: (open: boolean) => void;
  toggleQuickCapture: () => void;
  // Streaming session tracking — called by the executor pipe for the
  // viewed session as a fast-path; the rail GET snapshot (synced via
  // `useRailContextHydrate`) covers all other sessions.
  setSessionStreaming: (sessionId: string, isStreaming: boolean) => void;
  /** Replace the full streaming set in one call — used by the rail
   *  hydrate hook on each poll. */
  setStreamingSessions: (sessionIds: string[]) => void;
  /** Replace the full pending-input set in one call — same usage. */
  setPendingInputSessions: (sessionIds: string[]) => void;
  /** Flip the rail between full and skinny renderings. */
  toggleRailCollapsed: () => void;
  setRailCollapsed: (collapsed: boolean) => void;
  toggleExecutionRailOpen: () => void;
  setExecutionRailOpen: (open: boolean) => void;
}

type DashboardContextType = DashboardState & DashboardActions;

const DashboardContext = createContext<DashboardContextType | null>(null);

const MOCK_AGENTS: Agent[] = [
  { id: "atlas", name: "Atlas", status: "active", task: "Building onboarding flow", color: "text-orange-500", bg: "bg-orange-500/10", progress: 65, icon: "\uD83E\uDDED", lastUpdate: "Component ready in ~12 min" },
  { id: "beacon", name: "Beacon", status: "active", task: "Competitor pricing analysis", color: "text-blue-400", bg: "bg-blue-400/10", progress: 88, icon: "\uD83D\uDCE1", lastUpdate: "Found 3 new pricing tiers" },
  { id: "ri", name: "Ri", status: "idle", task: null, color: "text-muted-foreground", bg: "bg-muted", progress: 0, icon: "\uD83E\uDDE0", lastUpdate: null },
];

const MOCK_TASKS: Task[] = [
  { id: 1, text: "Review Atlas onboarding component", project: "Atlas", due: "Today", status: "ready", color: "bg-orange-500" },
  { id: 2, text: "Review Beacon pricing analysis", project: "Beacon", due: "Today", status: "waiting", color: "bg-blue-400" },
  { id: 3, text: "Spark learning loop wireframes", project: "Spark", due: "Tomorrow", status: "todo", color: "bg-amber-500" },
  { id: 4, text: "Bloom: pediatric sleep data sources", project: "Bloom", due: "Friday", status: "todo", color: "bg-emerald-500" },
  { id: 5, text: "Personal: March investor update", project: "Personal", due: "Mar 22", status: "todo", color: "bg-zinc-500" },
  { id: 6, text: "Eon contact sync bug", project: "Eon", due: null, status: "todo", color: "bg-pink-500" },
  { id: 7, text: "Ri: plan v2 knowledge graph schema", project: "Ri", due: "Next Week", status: "todo", color: "bg-muted-foreground" },
];

const MOCK_STREAM_EVENTS: StreamEvent[] = [
  { text: "Decided: Weaviate for Ri vector layer", time: "9:04 am", color: "bg-muted-foreground" },
  { text: "Beacon agent: competitor price change flagged", time: "8:52 am", color: "bg-blue-400" },
  { text: "Rationale queued to Slack via Orchestrator", time: "8:10 am", color: "bg-zinc-500" },
];

const DEFAULT_PANEL_A_TAB: AnyPanelTab = 'deck';
const DEFAULT_PANEL_B_TAB: AnyPanelTab = 'chat';

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');
  // ─── Active view (URL-canonical, local-mirror for snappy swaps) ──
  // Which primary surface fills the main area: 'command' (default
  // dashboard) or a chat_session id (execution view).
  //
  // The URL (`?session=`) stays the canonical owner: it drives SSR (the home
  // route is force-dynamic, so a `/?session=` link paints the right surface
  // on the first frame), deep links, and Back/Forward. But we *render* from a
  // local mirror seeded from the URL, because Next dispatches the
  // pushState→useSearchParams update as a concurrent (non-urgent) transition
  // — driving the view straight off `useSearchParams()` makes an in-app open
  // feel laggy. Updating local state in `setActiveView` is an urgent render,
  // so the surface swaps this frame; the URL write rides alongside.
  //
  // Not a second source of truth: the mirror only ever reconciles *to* the
  // URL (effect below) — Back/Forward, deep links, and external <Link>s flow
  // URL→mirror; in-app nav writes both together. They can't durably diverge.
  const urlView: ActiveView = useSearchParams().get('session') ?? 'command';
  const [activeView, setActiveViewLocal] = useState<ActiveView>(urlView);
  useEffect(() => {
    // Reconcile when the URL changes from outside (Back/Forward, deep link,
    // a <Link> elsewhere). No-op right after our own setActiveView, since the
    // mirror already holds this value.
    setActiveViewLocal((prev) => (prev === urlView ? prev : urlView));
  }, [urlView]);
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
  const [panelATab, setPanelATab] = useState<AnyPanelTab>(DEFAULT_PANEL_A_TAB);
  const [panelBTab, setPanelBTab] = useState<AnyPanelTab>(DEFAULT_PANEL_B_TAB);
  const [focusedPanel, setFocusedPanel] = useState<PanelId>('a');
  const panelLayoutResetRef = useRef<(() => void) | null>(null);
  const registerPanelLayoutReset = useCallback((fn: (() => void) | null) => {
    panelLayoutResetRef.current = fn;
  }, []);
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
  // ─── Quick capture ────────────────────────────────────────
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const toggleQuickCapture = useCallback(() => setQuickCaptureOpen((prev) => !prev), []);

  // ─── Streaming sessions ──────────────────────────────────
  const [streamingSessionIds, setStreamingSessionIds] = useState<Set<string>>(() => new Set());
  const setSessionStreaming = useCallback((sessionId: string, isStreaming: boolean) => {
    setStreamingSessionIds((prev) => {
      const has = prev.has(sessionId);
      if (isStreaming === has) return prev;
      const next = new Set(prev);
      if (isStreaming) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }, []);
  const setStreamingSessions = useCallback((sessionIds: string[]) => {
    hot('call setStreamingSessions');
    setStreamingSessionIds((prev) => {
      if (sessionIds.length === prev.size && sessionIds.every((id) => prev.has(id))) {
        return prev;
      }
      hot('change setStreamingSessions (set replaced)');
      return new Set(sessionIds);
    });
  }, []);

  // ─── Pending-input sessions ─────────────────────────────
  const [pendingInputSessionIds, setPendingInputSessionIds] = useState<Set<string>>(() => new Set());
  const setPendingInputSessions = useCallback((sessionIds: string[]) => {
    hot('call setPendingInputSessions');
    setPendingInputSessionIds((prev) => {
      if (sessionIds.length === prev.size && sessionIds.every((id) => prev.has(id))) {
        return prev;
      }
      hot('change setPendingInputSessions (set replaced)');
      return new Set(sessionIds);
    });
  }, []);

  // ─── Rail collapsed mode ────────────────────────────────
  // SSR-safe: start expanded, then hydrate from localStorage so the
  // first client paint matches the persisted choice.
  const [railCollapsed, setRailCollapsedState] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('flow.rail.collapsed');
    if (stored === '1') setRailCollapsedState(true);
  }, []);
  const setRailCollapsed = useCallback((next: boolean) => {
    setRailCollapsedState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('flow.rail.collapsed', next ? '1' : '0');
    }
  }, []);
  const toggleRailCollapsed = useCallback(() => {
    setRailCollapsedState((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('flow.rail.collapsed', next ? '1' : '0');
      }
      return next;
    });
  }, []);

  // ─── Last viewed execution id ───────────────────────────
  // Recorded on every setActiveView(sessionId) so ⌘E from the
  // dashboard can re-open the most recently visited execution.
  // Persisted to survive reload.
  const [lastExecutionId, setLastExecutionIdState] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('flow.execution.lastId');
    if (stored) setLastExecutionIdState(stored);
  }, []);
  // Record the last-viewed execution whenever the URL points at one.
  // Purely downstream of `activeView` (the URL) — never read to decide the
  // current view, only consulted by ⌘E "reopen last" when no `?session=` is
  // present. Persisted so it survives reload. Runs after the hydrate effect
  // above, so on a `/?session=x` deep link this freshest value wins.
  useEffect(() => {
    if (activeView === 'command' || typeof window === 'undefined') return;
    setLastExecutionIdState(activeView);
    window.localStorage.setItem('flow.execution.lastId', activeView);
  }, [activeView]);

  // ─── Execution-view rail open ───────────────────────────
  // Per-execution-view override: when on an execution surface the rail
  // defaults to skinny, but this lets ⌘\ open it back up. Persisted
  // separately from `railCollapsed` so the global preference is
  // untouched.
  const [executionRailOpen, setExecutionRailOpenState] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('flow.rail.execution.open');
    if (stored === '1') setExecutionRailOpenState(true);
  }, []);
  const setExecutionRailOpen = useCallback((next: boolean) => {
    setExecutionRailOpenState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('flow.rail.execution.open', next ? '1' : '0');
    }
  }, []);
  const toggleExecutionRailOpen = useCallback(() => {
    setExecutionRailOpenState((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('flow.rail.execution.open', next ? '1' : '0');
      }
      return next;
    });
  }, []);

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
    panelLayoutResetRef.current?.();
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
    setMobileTab('deck');
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

  // Navigate: swap the surface this frame (urgent local update), then write
  // the URL. `window.history.pushState` integrates with Next's router and
  // creates a real history entry, so Back/Forward move between executions;
  // the urgent mirror update keeps the swap snappy instead of waiting on the
  // router transition. Other query params are preserved so future surfaces
  // (?task=, ?note=) can compose; 'command' just drops the `session` param.
  // `activeExecutionId` is intentionally NOT touched here — ExecutionView
  // owns it (set from the loaded session, cleared on unmount), which keeps
  // click-nav and Back/Forward symmetric (the latter never calls this).
  const setActiveView = useCallback((view: ActiveView) => {
    setActiveViewLocal(view);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (view === 'command') params.delete('session');
    else params.set('session', view);
    const qs = params.toString();
    window.history.pushState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, []);

  return (
    <DashboardContext.Provider value={{
      theme,
      activeView,
      activeExecutionId,
      panelATab,
      panelBTab,
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
      setActiveExecutionId,
      setPanelTab,
      setFocusedPanel,
      resetLayout,
      registerPanelLayoutReset,
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
      quickCaptureOpen,
      setQuickCaptureOpen,
      toggleQuickCapture,
      streamingSessionIds,
      setSessionStreaming,
      setStreamingSessions,
      pendingInputSessionIds,
      setPendingInputSessions,
      railCollapsed,
      toggleRailCollapsed,
      setRailCollapsed,
      executionRailOpen,
      toggleExecutionRailOpen,
      setExecutionRailOpen,
      lastExecutionId,
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

/**
 * Non-throwing variant for components that render both inside the dashboard
 * and on standalone routes (e.g. entity chips in the `/task/[id]` and
 * `/note/[id]` slideout chats, which are NOT wrapped in DashboardProvider).
 * Returns `null` when there's no provider so callers can degrade gracefully
 * (typically by navigating via the router instead of opening a slideout).
 */
export function useOptionalDashboard() {
  return useContext(DashboardContext);
}
