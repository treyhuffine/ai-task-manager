'use client';

import { useState, type ReactNode } from 'react';
import { AppWindow, FolderTree, MessagesSquare, Settings2, X, type LucideIcon } from 'lucide-react';
import type { WorkspaceRecord } from '@/db/types';
import type { AgentTab } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { AgentOverview } from './agent-overview';
import { AgentFiles } from './agent-files';
import { AgentPreview } from './agent-preview';
import { AgentSetup } from './agent-setup';
import { Tip } from '@/components/ui/tip';
import { BesideFileTab, BesideFileView } from '@/components/chat-ui/artifacts/artifact-beside';
import { PanelWindowControls, panelTabClass } from '@/components/executions/workbench/panel-strip';
import { AgentBesideChat, BesideChatTabLabel } from './agent-beside-chat';

/**
 * The tools, in order: the panel's tabs, and the rows of the box shown while
 * it's closed. The terminal isn't one: it's the drawer across the bottom,
 * as in an execution (docs/agents-view-spec.md §10).
 */
export const AGENT_TOOL_TABS: ReadonlyArray<{ id: AgentTab; label: string; Icon: LucideIcon }> = [
  // Mostly the agent's chats, so it says so. The id stays: URLs and saved tabs use it.
  { id: 'overview', label: 'Chats', Icon: MessagesSquare },
  { id: 'files', label: 'Files', Icon: FolderTree },
  { id: 'preview', label: 'Preview', Icon: AppWindow },
  { id: 'setup', label: 'Setup', Icon: Settings2 },
];

/** A chat open beside the main chat, as a tab in the tools (docs/agents-view-spec.md, "Chats beside the agent"). */
export interface BesideChatTab {
  id: string;
  /** Its tab is in front. */
  active: boolean;
  onShow: () => void;
  /** Put it away. The chat itself keeps going. */
  onClose: () => void;
  /** Show another chat in its place. */
  onOpenChat: (chatId: string) => void;
  onOpenFull: (chatId: string) => void;
}

/**
 * The agent view's tools panel, with the execution view's strip
 * (`WorkbenchPanel`): underlined tabs whose labels fold to icons in a narrow
 * panel, then expand and close at the right. A tab stays mounted once
 * visited, so the file tree keeps its expanded folders and a preview its
 * page when the user flips between tabs. Keyed by agent in `AgentView`, so
 * moving to another agent starts fresh.
 *
 * A file or a chat opened from the main chat joins the strip after the
 * tools, in front until another tab is picked, with × to put it away.
 */
export function AgentTools({
  workspace,
  tab,
  onSelectTab,
  file,
  chat,
  panel,
}: {
  workspace: WorkspaceRecord;
  tab: AgentTab;
  onSelectTab: (tab: AgentTab) => void;
  /** The file beside the main chat: its surface, whether its tab is in front, and how to bring it there. */
  file?: { host: string; active: boolean; onShow: () => void } | null;
  /** The chat beside the main chat. */
  chat?: BesideChatTab | null;
  /** Expand and close, beside the main chat. One pane at a time has the Chat / Tools switch instead. */
  panel?: { maximized: boolean; onToggleMaximize: () => void; onClose: () => void } | null;
}) {
  const chatActive = !!chat?.active;
  const fileActive = !!file?.active && !chatActive;
  const toolActive = !fileActive && !chatActive;
  // Every tab the user has opened in this agent, the current one included.
  // Derived during render, so a tab that arrives through the URL mounts
  // straight away.
  const [visited, setVisited] = useState<ReadonlySet<AgentTab>>(() => new Set([tab]));
  if (!visited.has(tab)) setVisited(new Set(visited).add(tab));

  const body = (id: AgentTab): ReactNode => {
    switch (id) {
      case 'overview':
        return <AgentOverview workspace={workspace} onSelectTab={onSelectTab} />;
      case 'files':
        return <AgentFiles workspace={workspace} />;
      case 'preview':
        return <AgentPreview workspace={workspace} active={tab === 'preview'} onOpenSetup={() => onSelectTab('setup')} />;
      case 'setup':
        return <AgentSetup workspace={workspace} />;
    }
  };

  return (
    <div className="@container/panel flex h-full min-h-0 min-w-0 flex-col bg-background">
      <div className="flex h-9 flex-shrink-0 items-stretch gap-0.5 border-b border-border pl-1 pr-1.5">
        <div role="tablist" aria-label="Agent tools" className="flex min-w-0 items-stretch gap-0.5">
          {AGENT_TOOL_TABS.map((t) => {
            const on = tab === t.id && toolActive;
            return (
              <Tip key={t.id} label={t.label} onlyWhenTextHidden>
                <button
                  type="button"
                  role="tab"
                  data-tab={t.id}
                  aria-selected={on}
                  onClick={() => onSelectTab(t.id)}
                  onDoubleClick={panel?.onToggleMaximize}
                  className={cn('flex items-center gap-1.5', panelTabClass(on))}
                >
                  <t.Icon size={13} />
                  <span className="@max-[560px]/panel:hidden">{t.label}</span>
                </button>
              </Tip>
            );
          })}
        </div>
        {/* Outside the tab list, which may hold only tabs: these two carry their ×. */}
        {file && (
          <BesideFileTab
            host={file.host}
            active={fileActive}
            onSelect={file.onShow}
            className={cn('gap-0.5', panelTabClass(fileActive))}
          />
        )}
        {chat && (
          <div className={cn('flex min-w-0 shrink items-center gap-0.5', panelTabClass(chatActive))}>
            <button
              type="button"
              aria-pressed={chatActive}
              onClick={chat.onShow}
              className="flex min-w-0 items-center gap-1.5 self-stretch outline-none focus-visible:underline"
            >
              <BesideChatTabLabel chatId={chat.id} />
            </button>
            <Tip label="Put it away. The chat keeps going.">
              <button
                type="button"
                aria-label="Put away the chat beside"
                onClick={chat.onClose}
                className="ml-1 inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X size={11} />
              </button>
            </Tip>
          </div>
        )}
        <span className="flex-1" />
        {panel && <PanelWindowControls maximized={panel.maximized} onToggleMaximize={panel.onToggleMaximize} onClose={panel.onClose} />}
      </div>
      <div className="flex-1 min-h-0 relative">
        {AGENT_TOOL_TABS.filter((t) => visited.has(t.id)).map((t) => (
          // Inactive tabs stay laid out (so a preview or a file keeps its
          // size) but are transparent and inert. Not `visibility: hidden`,
          // which a descendant that sets `visibility: visible` would override
          // and paint through the tab on screen.
          <div
            key={t.id}
            role="tabpanel"
            data-agent-tab={t.id}
            inert={tab !== t.id || !toolActive}
            className={cn('absolute inset-0 flex flex-col min-h-0', tab === t.id ? 'z-10' : 'opacity-0')}
          >
            {body(t.id)}
          </div>
        ))}
        {/* Mounted while there's a file, like a visited tab, so a PDF keeps its page behind another tab. */}
        {file && (
          <div inert={!fileActive} className={cn('absolute inset-0 flex flex-col min-h-0', fileActive ? 'z-20' : 'pointer-events-none opacity-0')}>
            <BesideFileView host={file.host} />
          </div>
        )}
        {/* Mounted while it's open, behind another tab too, so its draft and scroll survive a look at Overview. */}
        {chat && (
          <div inert={!chatActive} className={cn('absolute inset-0 flex flex-col min-h-0', chatActive ? 'z-30' : 'pointer-events-none opacity-0')}>
            <AgentBesideChat
              chatId={chat.id}
              agent={workspace}
              active={chatActive}
              onOpenChat={chat.onOpenChat}
              onOpenFull={chat.onOpenFull}
              onClose={chat.onClose}
            />
          </div>
        )}
      </div>
    </div>
  );
}
