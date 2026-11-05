'use client';

import { useState, type RefObject } from 'react';
import { Command } from 'cmdk';
import { Bot, ChevronDown, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Attachment } from '@/db/types';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { cn } from '@/lib/utils';
import { WorkspaceAvatar } from './history-row';
import { LauncherPopoverContent } from './launcher/launcher-popover';

/** What the agent filter needs to name and picture an agent. */
interface AgentOption {
  id: string;
  name: string;
  emoji: string | null;
  attachments: Attachment[] | null;
}

/**
 * Narrows a list of chats to one agent's (Search chats, the rail's Unread).
 * The list filters as you type and takes arrows and Enter, like the launcher's
 * agent picker, and "All agents" at its top clears it.
 */
export function AgentFilter({
  agents,
  value,
  onChange,
  label,
  dialogInput,
}: {
  agents: readonly AgentOption[];
  value: AgentOption | null;
  onChange: (id: string | null) => void;
  /** The trigger's accessible name: what it narrows, and to which agent. */
  label: string;
  /**
   * The query box of the dialog this sits in. The list then renders in-tree,
   * inside the dialog's scroll lock, so it scrolls with a trackpad
   * (launcher-popover.tsx), and closing it puts focus back in the box, so
   * arrows and Enter drive the results again.
   */
  dialogInput?: RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };
  const Content = dialogInput ? LauncherPopoverContent : PopoverContent;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'flex min-w-0 max-w-[11rem] items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] transition-colors',
            value
              ? 'bg-muted/60 font-medium text-foreground hover:bg-muted'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          )}
        >
          {value ? <AgentIcon agent={value} /> : <Bot size={12} className="flex-shrink-0" />}
          <span className="truncate">{value?.name ?? 'All agents'}</span>
          <ChevronDown size={11} className="flex-shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <Content
        align="end"
        className="w-64 p-0"
        onCloseAutoFocus={
          dialogInput
            ? (e) => {
                e.preventDefault();
                dialogInput.current?.focus();
              }
            : undefined
        }
      >
        <Command loop defaultValue={value ? agentItemValue(value) : ALL_AGENTS} className="flex flex-col">
          <div className="flex items-center gap-1.5 border-b border-border px-2.5">
            <Search size={11} className="flex-shrink-0 text-muted-foreground/60" />
            <Command.Input
              placeholder="Find an agent…"
              className="h-8 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <Command.List className="max-h-64 overflow-y-auto p-1">
            <Command.Empty className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              No agent by that name
            </Command.Empty>
            <Command.Item
              value={ALL_AGENTS}
              onSelect={() => pick(null)}
              className={cn(AGENT_ITEM_CLASS, !value && 'font-medium text-foreground')}
            >
              <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                <Bot size={12} className="text-muted-foreground/70" />
              </span>
              All agents
            </Command.Item>
            {agents.map((w) => (
              <Command.Item
                key={w.id}
                value={agentItemValue(w)}
                onSelect={() => pick(w.id)}
                className={cn(AGENT_ITEM_CLASS, w.id === value?.id && 'font-medium text-foreground')}
              >
                <AgentIcon agent={w} />
                <span className="truncate">{w.name}</span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </Content>
    </Popover>
  );
}

const ALL_AGENTS = 'All agents';

const AGENT_ITEM_CLASS =
  'flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-foreground/90 data-[selected=true]:bg-muted/70 data-[selected=true]:text-foreground';

/** Name plus id, so two agents with one name are still two items. */
function agentItemValue(agent: AgentOption): string {
  return `${agent.name} ${agent.id}`;
}

/** The agent's picture at chip size, drawn the way result rows draw it. */
function AgentIcon({ agent }: { agent: AgentOption }) {
  return (
    <WorkspaceAvatar
      size="sm"
      wsImage={coverAttachmentUrl(agent.attachments)}
      wsEmoji={agent.emoji}
      wsName={agent.name}
    />
  );
}
