'use client';

import { useState, type ReactNode } from 'react';
import { AppWindow, FolderTree, LayoutGrid, Settings2, SquareTerminal, X } from 'lucide-react';
import type { WorkspaceRecord } from '@/db/types';
import type { AgentTab } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { AgentOverview } from './agent-overview';
import { AgentFiles } from './agent-files';
import { AgentTerminal } from './agent-terminal';
import { AgentPreview } from './agent-preview';
import { AgentSetup } from './agent-setup';
import { Tip } from '@/components/ui/tip';
import { BesideFileClose, BesideFileTab, BesideFileView } from '@/components/chat-ui/artifacts/artifact-beside';
import { AgentBesideChat, BesideChatTabLabel } from './agent-beside-chat';

const TABS: ReadonlyArray<{ id: AgentTab; label: string; icon: ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <LayoutGrid size={12} /> },
  { id: 'files', label: 'Files', icon: <FolderTree size={12} /> },
  { id: 'terminal', label: 'Terminal', icon: <SquareTerminal size={12} /> },
  { id: 'preview', label: 'Preview', icon: <AppWindow size={12} /> },
  { id: 'setup', label: 'Setup', icon: <Settings2 size={12} /> },
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
 * The agent view's tools panel. A tab stays mounted once visited, so a
 * terminal keeps its scrollback and the file tree its expanded folders when
 * the user flips between tabs. Keyed by agent in `AgentView`, so moving to
 * another agent starts fresh.
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
}: {
  workspace: WorkspaceRecord;
  tab: AgentTab;
  onSelectTab: (tab: AgentTab) => void;
  /** The file beside the main chat: its surface, whether its tab is in front, and how to bring it there. */
  file?: { host: string; active: boolean; onShow: () => void } | null;
  /** The chat beside the main chat. */
  chat?: BesideChatTab | null;
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
      case 'terminal':
        return <AgentTerminal workspace={workspace} />;
      case 'preview':
        return <AgentPreview workspace={workspace} active={tab === 'preview'} onOpenSetup={() => onSelectTab('setup')} />;
      case 'setup':
        return <AgentSetup workspace={workspace} />;
    }
  };

  return (
    <div className="@container flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center gap-0.5 border-b border-border px-2 py-1">
      <div role="tablist" aria-label="Agent tools" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {TABS.map((t) => (
          <Tip key={t.id} label={t.label} onlyWhenTextHidden>
            <button
              role="tab"
              aria-selected={tab === t.id && toolActive}
              onClick={() => onSelectTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap',
                tab === t.id && toolActive
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
            >
              {t.icon}
              <span className="hidden @[380px]:inline">{t.label}</span>
            </button>
          </Tip>
        ))}
        {file && (
          <BesideFileTab
            host={file.host}
            active={fileActive}
            onSelect={file.onShow}
            withClose={false}
            selectProps={{ role: 'tab', 'aria-selected': fileActive }}
            className={cn(
              'px-2 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap',
              fileActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            )}
          />
        )}
      </div>
      {/* Outside the tab list, which may hold only tabs. */}
      {file && <BesideFileClose host={file.host} />}
      {chat && (
        // A tab of its own with its ×, outside the list for the same reason.
        <div
          className={cn(
            'ml-1 flex min-w-0 shrink items-center rounded-md transition-colors',
            chatActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          )}
        >
          <button
            type="button"
            aria-pressed={chatActive}
            onClick={chat.onShow}
            className="flex min-w-0 items-center gap-1.5 py-1 pl-2 pr-1 text-[11px] font-medium whitespace-nowrap outline-none focus-visible:underline"
          >
            <BesideChatTabLabel chatId={chat.id} />
          </button>
          <Tip label="Put it away. The chat keeps going.">
            <button
              type="button"
              aria-label="Put away the chat beside"
              onClick={chat.onClose}
              className="mr-1 inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X size={11} />
            </button>
          </Tip>
        </div>
      )}
      </div>
      <div className="flex-1 min-h-0 relative">
        {TABS.filter((t) => visited.has(t.id)).map((t) => (
          // Inactive tabs stay laid out (so a terminal keeps its size) but
          // are transparent and inert. Not `visibility: hidden`, which a
          // descendant that sets `visibility: visible` (the terminal panel
          // does) would override and paint through the tab on screen.
          <div
            key={t.id}
            role="tabpanel"
            inert={tab !== t.id || !toolActive}
            className={cn('absolute inset-0 flex flex-col min-h-0', tab === t.id ? 'z-10' : 'opacity-0')}
          >
            {body(t.id)}
          </div>
        ))}
        {/* Mounted while there's a file, like a visited tab, so a PDF keeps its page behind another tab. */}
        {file && (
          <div role="tabpanel" inert={!fileActive} className={cn('absolute inset-0 flex flex-col min-h-0', fileActive ? 'z-20' : 'pointer-events-none opacity-0')}>
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
