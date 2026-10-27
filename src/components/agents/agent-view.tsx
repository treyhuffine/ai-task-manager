'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { apiErrorStatus } from '@/lib/api/client';
import { ChatLookupState, ChatRefreshBoundary } from '@/components/chat/chat-lookup-state';
import {
  useDefaultLayout,
  usePanelRef,
  type Layout,
  type LayoutStorage,
  type PanelSize,
} from 'react-resizable-panels';
import { WorkContext, useWorkActivity, useWorkNavigation, type WorkNavigation } from '@/contexts/work-context';
import { useWorkspace } from '@/hooks/use-workspaces';
import { useElementWidth } from '@/hooks/use-element-width';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { DEFAULT_AGENT_TAB, readLastAgentTab, writeLastAgentTab } from '@/lib/client/agent-view-tab';
import type { AgentTab } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { AgentHeader } from './agent-header';
import { AgentChatPanel } from './agent-chat-panel';
import { AgentTools, type BesideChatTab } from './agent-tools';
import { useMainChat } from '@/hooks/use-main-chat';
import { useAgentChatPlace } from '@/lib/client/agent-chat-place';
import { routeAgentChat } from '@/lib/client/agent-chat-routing';
import { hasWorkbenchView } from '@/components/executions/workbench/view-request';
import { useHomeStorageScope } from '@/components/home/home-context';
import { homeStorageIdentity } from '@/lib/home/document-scope';
import { useBesidePreview, useBesideRegion } from '@/components/chat-ui/artifacts/artifact-preview-provider';
import { PREVIEW_HOST_ATTRIBUTE } from '@/components/chat-ui/artifacts/artifact-preview-store';

/**
 * An agent's view (docs/agents-view-spec.md Phase 7): its main chat on the
 * left, its tools on the right as tabs. This is the oversight surface. The
 * execution view is the workbench, which is why only the execution view
 * collapses the rail.
 *
 * One layout for every agent (`ri.agent.layout`), so each agent opens the
 * same shape. The tools panel collapses so the chat can go full width.
 *
 * Measured, not viewport-based: below `NARROW_WIDTH` of its own width (a
 * phone, a tablet, a squeezed window) it shows one pane at a time, chat
 * first, with a Chat / Tools switch in the header. Both panes stay mounted,
 * so switching keeps the chat's draft and a terminal's scrollback.
 *
 * A chat opened from inside the view (a link in the main chat, a row in
 * Overview, a chat chip) opens in the tools as one more tab, beside the main
 * chat, rather than leaving for its full view (docs/agents-view-spec.md,
 * "Chats beside the agent"). That needs room for two panes and a URL that
 * can say so (`onNavigate`), and it's a trial with a setting back to the
 * full view (`agent-chat-place.ts`). Routing: `agent-chat-routing.ts`.
 */

/** What's in front in the tools: a tool tab, the file beside, or the chat beside. */
type Front = 'tool' | 'file' | 'chat';

const CHAT_PANEL = 'agent-chat';
const TOOLS_PANEL = 'agent-tools';
const DEFAULT_LAYOUT: Layout = { [CHAT_PANEL]: 42, [TOOLS_PANEL]: 58 };

// SSR-safe storage shim, as in panel-layout.tsx.
const NOOP_STORAGE: LayoutStorage = { getItem: () => null, setItem: () => {} };

const noopSubscribe = () => () => {};

/** Below this container width the view shows one pane at a time. */
const NARROW_WIDTH = 820;

export type AgentPane = 'chat' | 'tools';

export function AgentView({
  workspaceId,
  tab,
  onBack,
  assumeNarrow = false,
  chatSessionId,
  besideChat = null,
  onNavigate,
}: {
  workspaceId: string;
  tab?: AgentTab;
  /** A back button in the header (the phone layout, where the view is a full screen). */
  onBack?: () => void;
  /** Start in one-pane mode until measured (the phone layout), so it never flashes two panels. */
  assumeNarrow?: boolean;
  /** An explicit saved conversation, independent of the agent's current main chat. */
  chatSessionId?: string;
  /** The chat open beside the main chat (`&chat=`), and one message in it (`&message=`). */
  besideChat?: { id: string; message?: string } | null;
  /**
   * Move within this agent's view: a tools tab, and the chat beside (null
   * puts it away). Given where the URL can carry a chat beside (the
   * personal dashboard). Without it, chats open in their full view.
   */
  onNavigate?: (tab: AgentTab | undefined, chat: { id: string; message?: string } | null) => void;
}) {
  const [measureRef, width] = useElementWidth<HTMLDivElement>();
  const narrow = width === null ? assumeNarrow : width < NARROW_WIDTH;
  // A tab in the URL means the user asked for a tool, so narrow mode opens on it.
  const [pane, setPane] = useState<AgentPane>(() => (tab ? 'tools' : 'chat'));
  const { data: workspace, error, fetchStatus, refetch } = useWorkspace(workspaceId);
  const navigation = useWorkNavigation();
  const activity = useWorkActivity();
  const { openAgent, goHome } = navigation;
  const storageId = homeStorageIdentity(workspaceId, useHomeStorageScope());

  // The chat beside the main chat: where the view can keep one, there's
  // room for two panes, and chats are set to open beside.
  const { place } = useAgentChatPlace();
  const besideId = onNavigate && place === 'beside' && !narrow ? besideChat?.id ?? null : null;
  // The main chat is already on the left, so a link to it stays put.
  const { data: currentMainChat } = useMainChat(workspaceId, !chatSessionId);
  const mainChatId = chatSessionId ?? currentMainChat?.session?.id ?? null;

  // The tab in the URL wins. Without one, the agent reopens on the tab it
  // last showed. Read through useSyncExternalStore so the server render and
  // hydration agree on the default.
  const lastTab = useSyncExternalStore(
    noopSubscribe,
    () => readLastAgentTab(storageId),
    () => DEFAULT_AGENT_TAB,
  );
  const activeTab = tab ?? lastTab;

  // A file or a chat opened from the main chat shows in the tools as one
  // more tab, in front until another tab is picked (here or through the
  // URL). Putting it away shows what it came forward over. Narrow, with one
  // pane at a time, files open large and chats in their full view instead.
  const besideHost = `agent:${workspaceId}`;
  const besideFile = useBesidePreview(besideHost);
  const [front, setFront] = useState<Front>(() => (besideId ? 'chat' : 'tool'));
  const [under, setUnder] = useState<Front>('tool');
  const bring = useCallback((next: Front) => {
    if (front !== next) setUnder(front);
    setFront(next);
  }, [front]);
  const [shownTab, setShownTab] = useState(activeTab);
  if (shownTab !== activeTab) {
    setShownTab(activeTab);
    setFront('tool');
    setUnder('tool');
  }
  // A chat arriving through the URL (Back, Forward, a reload) comes forward too.
  const [shownChat, setShownChat] = useState(besideId);
  if (shownChat !== besideId) {
    setShownChat(besideId);
    if (besideId) {
      if (front !== 'chat') setUnder(front);
      setFront('chat');
    }
  }
  // What's actually in front: what was brought forward while it's still
  // there, else what it covered, else the tool.
  const has = (f: Front) => (f === 'file' ? !!besideFile : f === 'chat' ? !!besideId : true);
  const shownFront: Front = has(front) ? front : front !== 'tool' && has(under) ? under : 'tool';
  const fileActive = shownFront === 'file';
  const chatActive = shownFront === 'chat';

  // Tools collapsed to make the chat full width open for a file or a chat,
  // and fold away again once both are put away, unless a tool was picked
  // meanwhile.
  const openedForBeside = useRef(false);

  const selectTab = useCallback(
    (next: AgentTab) => {
      setFront('tool');
      setUnder('tool');
      openedForBeside.current = false;
      writeLastAgentTab(storageId, next);
      // Picking a tool keeps the chat beside as a tab behind it.
      if (onNavigate) onNavigate(next, besideChat ? { id: besideChat.id } : null);
      else openAgent(workspaceId, next, chatSessionId);
    },
    [openAgent, onNavigate, besideChat, workspaceId, storageId, chatSessionId],
  );

  const [storage] = useState<LayoutStorage>(() => (typeof window === 'undefined' ? NOOP_STORAGE : window.localStorage));
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'ri.agent.layout', storage });
  const toolsRef = usePanelRef();
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const onToolsResize = useCallback((size: PanelSize) => setToolsCollapsed(size.inPixels < 1), []);
  const toggleTools = useCallback(() => {
    const panel = toolsRef.current;
    if (!panel) return;
    // Set by hand now, so putting the file or chat away leaves them as they are.
    openedForBeside.current = false;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  }, [toolsRef]);
  const expandForBeside = useCallback(() => {
    const panel = toolsRef.current;
    if (panel?.isCollapsed()) {
      panel.expand();
      openedForBeside.current = true;
    }
  }, [toolsRef]);

  const showFile = useCallback(() => {
    expandForBeside();
    bring('file');
  }, [expandForBeside, bring]);
  useEffect(() => {
    if (besideFile || besideId || !openedForBeside.current) return;
    openedForBeside.current = false;
    toolsRef.current?.collapse();
  }, [besideFile, besideId, toolsRef]);
  // A tool picked through the URL is a tool in use, as one picked here is.
  useEffect(() => { openedForBeside.current = false; }, [activeTab]);

  // ── The chat beside ────────────────────────────────────────────────
  const openBeside = useCallback(
    (id: string, message?: string) => {
      onNavigate?.(tab, { id, message });
      expandForBeside();
      bring('chat');
    },
    [onNavigate, tab, expandForBeside, bring],
  );
  const closeBeside = useCallback(() => {
    onNavigate?.(tab, null);
    setFront((current) => (current === 'chat' ? under : current));
    setUnder('tool');
  }, [onNavigate, tab, under]);
  const showChat = useCallback(() => bring('chat'), [bring]);
  const openFull = useCallback((id: string) => navigation.openExecution(id), [navigation]);

  // Everything inside the view (the main chat's links, Overview's rows,
  // chips in either chat) opens chats through this, so they land beside.
  const routed = useMemo<WorkNavigation>(() => {
    if (!onNavigate) return navigation;
    const route = (id: string) =>
      routeAgentChat({ chatId: id, mainChatId, place, narrow, canKeepBeside: true, wantsWorkbench: hasWorkbenchView(id) });
    return {
      ...navigation,
      openExecution: (id) => {
        const where = route(id);
        if (where === 'beside') openBeside(id);
        else if (where === 'full') navigation.openExecution(id);
      },
      openLinkedChat: (id, eventId) => {
        const where = route(id);
        if (where === 'beside') openBeside(id, eventId);
        else if (where === 'full') (navigation.openLinkedChat ?? navigation.openExecution)(id, eventId);
      },
      // This agent, from inside it: stay, keeping the chat beside.
      openAgent: (id, nextTab, chatId) => {
        if (id !== workspaceId || chatId) return navigation.openAgent(id, nextTab, chatId);
        if (nextTab) selectTab(nextTab);
      },
    };
  }, [navigation, onNavigate, mainChatId, place, narrow, openBeside, workspaceId, selectTab]);
  // Overview marks the row of the chat beside, as the rail marks an open one.
  const routedActivity = useMemo(
    () => (besideId ? { ...activity, activeSessionId: besideId } : activity),
    [activity, besideId],
  );

  // The tools hotkey, as in an execution: shows or hides the tools panel, or
  // switches panes when there's room for one. Only the copy on screen listens
  // (the dashboard mounts a layout per screen size and hides the others).
  const onScreen = !!width;
  useBesideRegion(besideHost, {
    available: onScreen && !narrow,
    side: 'right',
    showing: onScreen && !narrow && !toolsCollapsed && fileActive,
    show: showFile,
  });
  useEffect(() => {
    if (!onScreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!matchesHotkey(e, HOTKEYS.toggleTools)) return;
      e.preventDefault();
      if (narrow) setPane((p) => (p === 'tools' ? 'chat' : 'tools'));
      else toggleTools();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onScreen, narrow, toggleTools]);

  // Measured in every state, so the layout is known before the agent loads.
  const frame = (children: React.ReactNode) => (
    <div ref={measureRef} className="flex-1 flex flex-col min-w-0 min-h-0 bg-background">
      <WorkContext navigation={routed} activity={routedActivity}>
        <ChatRefreshBoundary error={workspace ? error : null} retry={() => void refetch()}>{children}</ChatRefreshBoundary>
      </WorkContext>
    </div>
  );

  if (!workspace && apiErrorStatus(error) !== 404) return frame(<ChatLookupState subject="agent" paused={fetchStatus === 'paused'} error={error} retry={() => void refetch()} />);

  if (!workspace) {
    return frame(
      <div className="flex-1 flex items-center justify-center text-center px-8">
        <div>
          <p className="text-[13px] font-semibold text-foreground">This agent isn&apos;t here anymore.</p>
          <p className="text-[11px] text-muted-foreground/80 mt-1">It may have been deleted, or the link is wrong.</p>
          <button
            onClick={goHome}
            className="mt-3 inline-flex items-center px-3 py-1.5 rounded-md text-[11px] font-medium text-primary hover:bg-primary/10"
          >
            Back to Home
          </button>
        </div>
      </div>,
    );
  }

  const chat = <AgentChatPanel key={workspace.id} workspace={workspace} sessionId={chatSessionId} />;
  const chatTab: BesideChatTab | null = besideId
    ? { id: besideId, active: chatActive, onShow: showChat, onClose: closeBeside, onOpenChat: openBeside, onOpenFull: openFull }
    : null;
  const tools = (
    <AgentTools
      key={workspace.id}
      workspace={workspace}
      tab={activeTab}
      onSelectTab={selectTab}
      file={narrow ? null : { host: besideHost, active: fileActive, onShow: showFile }}
      chat={chatTab}
    />
  );

  return frame(
    <>
      <AgentHeader
        workspace={workspace}
        toolsCollapsed={toolsCollapsed}
        onToggleTools={toggleTools}
        onBack={onBack}
        pane={narrow ? { value: pane, onChange: setPane } : undefined}
      />
      {narrow ? (
        <div className="relative flex-1 min-h-0">
          {(['chat', 'tools'] as const).map((p) => (
            <div
              key={p}
              inert={pane !== p}
              className={cn('absolute inset-0 flex flex-col min-h-0', pane === p ? 'z-10' : 'opacity-0')}
            >
              {p === 'chat' ? chat : tools}
            </div>
          ))}
        </div>
      ) : (
      <ResizablePanelGroup
        orientation="horizontal"
        defaultLayout={defaultLayout ?? DEFAULT_LAYOUT}
        onLayoutChanged={onLayoutChanged}
        className="flex-1 min-h-0"
      >
        <ResizablePanel id={CHAT_PANEL} minSize={360} className="flex flex-col min-w-0 min-h-0">
          {/* Keyed by agent so a switch between agents never shows the
              previous agent's chat for a frame. Its files open in the tools. */}
          <div {...{ [PREVIEW_HOST_ATTRIBUTE]: besideHost }} className="contents">{chat}</div>
        </ResizablePanel>
        <ResizableHandle
          className={cn(
            'w-[3px] bg-border hover:bg-primary/50 transition-colors',
            'after:absolute after:inset-y-0 after:-left-1.5 after:-right-1.5 after:w-auto after:translate-x-0',
          )}
        />
        <ResizablePanel
          id={TOOLS_PANEL}
          panelRef={toolsRef}
          collapsible
          collapsedSize={0}
          minSize="28%"
          onResize={onToolsResize}
          className="flex flex-col min-w-0 min-h-0"
        >
          {tools}
        </ResizablePanel>
      </ResizablePanelGroup>
      )}
    </>,
  );
}
