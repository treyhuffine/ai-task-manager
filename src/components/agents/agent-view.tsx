'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import {
  useDefaultLayout,
  usePanelRef,
  type Layout,
  type LayoutStorage,
  type PanelSize,
} from 'react-resizable-panels';
import { useDashboard } from '@/contexts/dashboard-context';
import { useWorkspace } from '@/hooks/use-workspaces';
import { useElementWidth } from '@/hooks/use-element-width';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { DEFAULT_AGENT_TAB, readLastAgentTab, writeLastAgentTab } from '@/lib/client/agent-view-tab';
import type { AgentTab } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { AgentHeader } from './agent-header';
import { AgentChatPanel } from './agent-chat-panel';
import { AgentTools } from './agent-tools';

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
 */

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
}: {
  workspaceId: string;
  tab?: AgentTab;
  /** A back button in the header (the phone layout, where the view is a full screen). */
  onBack?: () => void;
  /** Start in one-pane mode until measured (the phone layout), so it never flashes two panels. */
  assumeNarrow?: boolean;
}) {
  const [measureRef, width] = useElementWidth<HTMLDivElement>();
  const narrow = width === null ? assumeNarrow : width < NARROW_WIDTH;
  // A tab in the URL means the user asked for a tool, so narrow mode opens on it.
  const [pane, setPane] = useState<AgentPane>(() => (tab ? 'tools' : 'chat'));
  const { data: workspace, isLoading } = useWorkspace(workspaceId);
  const { openAgent, goHome } = useDashboard();

  // The tab in the URL wins. Without one, the agent reopens on the tab it
  // last showed. Read through useSyncExternalStore so the server render and
  // hydration agree on the default.
  const lastTab = useSyncExternalStore(
    noopSubscribe,
    () => readLastAgentTab(workspaceId),
    () => DEFAULT_AGENT_TAB,
  );
  const activeTab = tab ?? lastTab;
  const selectTab = useCallback(
    (next: AgentTab) => {
      writeLastAgentTab(workspaceId, next);
      openAgent(workspaceId, next);
    },
    [openAgent, workspaceId],
  );

  const [storage] = useState<LayoutStorage>(() => (typeof window === 'undefined' ? NOOP_STORAGE : window.localStorage));
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'ri.agent.layout', storage });
  const toolsRef = usePanelRef();
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const onToolsResize = useCallback((size: PanelSize) => setToolsCollapsed(size.inPixels < 1), []);
  const toggleTools = useCallback(() => {
    const panel = toolsRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  }, [toolsRef]);

  // Measured in every state, so the layout is known before the agent loads.
  const frame = (children: React.ReactNode) => (
    <div ref={measureRef} className="flex-1 flex flex-col min-w-0 min-h-0 bg-background">
      {children}
    </div>
  );

  if (isLoading) {
    return frame(
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>,
    );
  }

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

  const chat = <AgentChatPanel key={workspace.id} workspace={workspace} />;
  const tools = <AgentTools key={workspace.id} workspace={workspace} tab={activeTab} onSelectTab={selectTab} />;

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
              previous agent's chat for a frame. */}
          {chat}
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
