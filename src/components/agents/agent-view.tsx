'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { apiErrorStatus } from '@/lib/api/client';
import { ChatLookupState, ChatRefreshBoundary } from '@/components/chat/chat-lookup-state';
import { WorkContext, useWorkActivity, useWorkNavigation, type WorkNavigation } from '@/contexts/work-context';
import { useWorkspace } from '@/hooks/use-workspaces';
import { useElementWidth } from '@/hooks/use-element-width';
import { useViewportTier } from '@/hooks/use-viewport-tier';
import { DEFAULT_AGENT_TAB, readLastAgentTab, writeLastAgentTab } from '@/lib/client/agent-view-tab';
import { workspaceFolder } from '@/lib/folders/source';
import type { AgentTab } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { AgentHeader } from './agent-header';
import { AgentChatPanel } from './agent-chat-panel';
import { AGENT_TOOL_TABS, AgentTools, type BesideChatTab } from './agent-tools';
import { AgentToolsBox } from './agent-tools-box';
import { DEFAULT_TOOLS_PCT, useAgentLayout } from './use-agent-layout';
import { PanelSplit, TerminalSplit, type TerminalSlot } from '@/components/executions/workbench/workbench-layout';
import { useWorkbenchHotkeys } from '@/components/executions/workbench/use-workbench-hotkeys';
import { useMainChat } from '@/hooks/use-main-chat';
import { useAgentChatPlace } from '@/lib/client/agent-chat-place';
import { routeAgentChat } from '@/lib/client/agent-chat-routing';
import { hasWorkbenchView } from '@/components/executions/workbench/view-request';
import { useHomeStorageScope } from '@/components/home/home-context';
import { homeStorageIdentity } from '@/lib/home/document-scope';
import { useBesidePreview, useBesideRegion } from '@/components/chat-ui/artifacts/artifact-preview-provider';

/**
 * An agent's view (docs/agents-view-spec.md Phase 7): its main chat on the
 * left, its tools on the right as tabs, and its terminal as a drawer across
 * the bottom. This is the oversight surface. The execution view is the
 * workbench, which is why only the execution view collapses the rail.
 *
 * The terminal and the tools work as an execution's do (§10): the same
 * splits (`workbench-layout.tsx`), header toggles, closed-tools box and
 * hotkeys (⌃` terminal, ⌃. tools, ⌘P Files, Esc). Open or closed persists
 * per agent (`use-agent-layout.ts`). The tools width is one preference for
 * every agent, and the terminal height is shared with executions. The
 * terminal runs in the agent's own folder, for a git agent the source
 * checkout, and only where an execution has one: the desktop layout.
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
  // The view's own element too, where ⌘P looks for the Files tree's search.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRoot = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node;
    return measureRef(node);
  }, [measureRef]);
  const narrow = width === null ? assumeNarrow : width < NARROW_WIDTH;
  // The terminal goes where an execution has one: the desktop layout. The
  // phone and tablet are thin clients (docs/execution-view-spec.md, "Phone").
  const terminalHere = useViewportTier() === 'desktop';
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

  // Open or closed, expanded, and the terminal, per agent. Tools closed to
  // make the chat full width open for a file or a chat, and close again
  // once both are put away, unless they were used by hand meanwhile
  // (`agent-layout.ts`).
  const layout = useAgentLayout(workspaceId);
  const { state: shape, dispatch } = layout;

  const selectTab = useCallback(
    (next: AgentTab) => {
      setFront('tool');
      setUnder('tool');
      dispatch({ type: 'toolPicked' });
      writeLastAgentTab(storageId, next);
      // Picking a tool keeps the chat beside as a tab behind it.
      if (onNavigate) onNavigate(next, besideChat ? { id: besideChat.id } : null);
      else openAgent(workspaceId, next, chatSessionId);
    },
    [openAgent, onNavigate, besideChat, workspaceId, storageId, chatSessionId, dispatch],
  );

  const toggleTools = useCallback(() => dispatch({ type: 'toggleTools' }), [dispatch]);
  const toggleTerminal = useCallback(() => dispatch({ type: 'toggleTerminal' }), [dispatch]);
  const expandForBeside = useCallback(() => dispatch({ type: 'openForBeside' }), [dispatch]);

  const showFile = useCallback(() => {
    expandForBeside();
    bring('file');
  }, [expandForBeside, bring]);
  useEffect(() => {
    if (besideFile || besideId) return;
    dispatch({ type: 'besideGone' });
  }, [besideFile, besideId, dispatch]);
  // A tool picked through the URL is a tool in use, as one picked here is.
  useEffect(() => { dispatch({ type: 'toolPicked' }); }, [activeTab, dispatch]);

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

  // ── The tools box, while the tools are closed ─────────────────────
  // A row opens the panel on that tool by hand, so putting a file or chat
  // away later leaves the panel open.
  const openTools = useCallback(() => dispatch({ type: 'openTools' }), [dispatch]);
  const showToolFromBox = useCallback((next: AgentTab) => {
    openTools();
    selectTab(next);
  }, [openTools, selectTab]);
  const showFileFromBox = useCallback(() => {
    openTools();
    bring('file');
  }, [openTools, bring]);
  const showChatFromBox = useCallback(() => {
    openTools();
    bring('chat');
  }, [openTools, bring]);
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
      // The only chat on screen here is the one beside (`routedActivity`).
      // Archiving it puts it away and stays on this agent, whichever agent
      // the chat is in.
      leaveChat: closeBeside,
    };
  }, [navigation, onNavigate, mainChatId, place, narrow, openBeside, workspaceId, selectTab, closeBeside]);
  // Overview marks the row of the chat beside, as the rail marks an open one.
  const routedActivity = useMemo(
    () => (besideId ? { ...activity, activeSessionId: besideId } : activity),
    [activity, besideId],
  );

  // The keys, as in an execution (`use-workbench-hotkeys.ts`). ⌃. shows or
  // hides the tools, or switches panes when there's room for one. Only the
  // copy on screen listens (the dashboard mounts a layout per screen size
  // and hides the others).
  const onScreen = !!width;
  const toolsOpen = !narrow && shape.toolsOpen;
  useBesideRegion(besideHost, {
    available: onScreen && !narrow,
    side: 'right',
    showing: onScreen && toolsOpen && fileActive,
    show: showFile,
  });
  useWorkbenchHotkeys({
    enabled: onScreen && !!workspace,
    toggleTerminal: terminalHere ? toggleTerminal : undefined,
    toggleTools: () => {
      if (narrow) setPane((p) => (p === 'tools' ? 'chat' : 'tools'));
      else toggleTools();
    },
    goToFile: () => {
      if (narrow) setPane('tools');
      else openTools();
      selectTab('files');
    },
    treeSearchRoot: () => rootRef.current?.querySelector('[data-agent-tab="files"]') ?? null,
    escape: () => {
      if (narrow || !shape.toolsOpen) return false;
      dispatch({ type: 'escape' });
      return true;
    },
  });

  // Measured in every state, so the layout is known before the agent loads.
  const frame = (children: React.ReactNode) => (
    <div ref={setRoot} className="flex-1 flex flex-col min-w-0 min-h-0 bg-background">
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

  // The tools box floats over the main chat while the panel is closed, as
  // the execution view's does. One pane at a time has the Chat / Tools
  // switch instead.
  const archived = workspace.status === 'archived';
  const terminalToggle = terminalHere ? { open: shape.terminalOpen, onToggle: toggleTerminal } : undefined;
  const toolsBox = onScreen && !narrow && !shape.toolsOpen ? (
    <AgentToolsBox
      workspace={workspace}
      onShow={showToolFromBox}
      terminal={terminalToggle}
      file={besideFile ? { host: besideHost, onShow: showFileFromBox } : null}
      chat={besideId ? { id: besideId, onShow: showChatFromBox } : null}
    />
  ) : null;
  const chat = <AgentChatPanel key={workspace.id} workspace={workspace} sessionId={chatSessionId} overlay={toolsBox} />;
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
      panel={narrow ? null : {
        maximized: shape.maximized,
        onToggleMaximize: () => dispatch({ type: 'toggleMaximize' }),
        onClose: () => dispatch({ type: 'closeTools' }),
      }}
    />
  );
  // What the Tools toggle brings back, for its tooltip.
  const showLabel = chatActive ? 'the chat beside' : fileActive ? 'the file beside' : AGENT_TOOL_TABS.find((t) => t.id === activeTab)?.label ?? 'the tools';

  // The drawer, in the agent's own folder: for a git agent, the source
  // checkout, never a worktree. Its strip names the folder. These shells
  // belong to the agent, separate from every execution's, and archiving the
  // agent closes them.
  const terminal: TerminalSlot | null = terminalHere && onScreen && shape.terminalOpen ? {
    source: workspaceFolder(workspace.id),
    disabled: archived,
    disabledReason: archived ? 'This agent is archived, so it has no terminal.' : undefined,
    maximized: shape.terminalMaximized,
    onToggleMaximize: () => dispatch({ type: 'toggleTerminalMaximize' }),
    onHide: toggleTerminal,
    pct: layout.terminalPct,
    onCommitPct: layout.setTerminalPct,
  } : null;

  return frame(
    <>
      <AgentHeader
        workspace={workspace}
        terminal={terminalToggle}
        tools={narrow ? undefined : { open: shape.toolsOpen, onToggle: toggleTools, showLabel }}
        onBack={onBack}
        pane={narrow ? { value: pane, onChange: setPane } : undefined}
      />
      <TerminalSplit terminal={terminal}>
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
          <PanelSplit
            // The chat is keyed by agent, so a switch between agents never
            // shows the previous agent's chat for a frame. Its files open in the tools.
            chat={chat}
            chatHost={besideHost}
            chatStrip={{
              label: chatSessionId ? 'Chat' : 'Main chat',
              status: mainChatId && activity.pendingInputSessionIds.has(mainChatId)
                ? 'needsInput'
                : mainChatId && activity.streamingSessionIds.has(mainChatId) ? 'working' : null,
              onRestore: () => dispatch({ type: 'toggleMaximize' }),
            }}
            panel={{
              open: shape.toolsOpen,
              maximized: shape.maximized,
              content: tools,
              pct: layout.toolsPct,
              defaultPct: DEFAULT_TOOLS_PCT,
              onCommitPct: layout.setToolsPct,
            }}
          />
        )}
      </TerminalSplit>
    </>,
  );
}
